/**
 * The workflow file a user commits to arm the autopilot.
 *
 * Note what the analysis half costs: nothing but a lurq key. Planning the
 * upgrades and checking them against the codebase are plain CLI steps, so a repo
 * gets the full drift + breakage brief without any Anthropic credential at all.
 * That is only needed once someone switches the job to `pr` mode and wants code
 * actually rewritten — and then either an API key or an existing Claude
 * Pro/Max subscription token will do.
 *
 * Read the `permissions:` block first — it is the entire trust model. lurq's own
 * GitHub App holds Contents:read-only plus Actions:write, so it can read the
 * manifests and START this workflow, and it can still never write a byte to
 * anyone's repository, rewrite this file, or set a repository variable.
 * Every write in this loop is done by GitHub's own `GITHUB_TOKEN`: ephemeral,
 * scoped to the one repo, and limited to exactly what this file declares. The
 * user owns the file, so revoking the autopilot is `git rm`.
 *
 * Two more guardrails are structural rather than advisory:
 *   · the agent's tool allowlist has no `git` and no network tool, so the model
 *     edits files and the *workflow* does version control — a prompt injection
 *     in a dependency's changelog cannot push a branch;
 *   · the job defaults to `comment` mode, which analyses and reports without
 *     touching a line. Editing is opt-in per repository.
 *
 * Three modes, and the middle one is the point. `fix` opens a pull request
 * containing only what the package itself proves — renamed call sites and the
 * range bump in every manifest — with no model and no Anthropic credential.
 * That is the same job Dependabot does, except the call sites are migrated too,
 * and unlike `pr` it cannot fail for want of a key. `pr` is `fix` plus the
 * agent, for the changes a rule cannot make.
 */

import { PACKAGE_NAME, VERSION } from '../core/constants';

export interface WorkflowOptions {
  /** Cron schedule. Default: Mondays 06:00 UTC. */
  cron?: string;
  /** Start in `pr` mode instead of the analyse-only default. */
  armed?: boolean;
  /**
   * How far the job may go, straight from `repoMode(policy)`. Takes precedence
   * over `armed`, which stays for callers that only know armed/not and reads as
   * the `pr`/`comment` pair it always did.
   */
  mode?: 'comment' | 'fix' | 'pr';
  /** Package manager install command, detected from the lockfile. */
  installCommand?: string;
  /** Max upgrades attempted per run — the blast-radius cap. */
  maxUpgrades?: number;
  /**
   * Include the environment check, per `RepoPolicy.checks.env`.
   *
   * Off unless granted, like every other permission: absent means not granted.
   * A repo whose policy predates checks has no such key and gets no step, which
   * is the same workflow it has today.
   */
  checkEnv?: boolean;
  /**
   * Run the CLI built from the checkout instead of the published package.
   *
   * For lurq's own repository, and any other whose package.json IS the CLI:
   * `npx -y lurqrun@0.1` there resolves to the LOCAL package, whose bin has not
   * been built, and the step dies with `lurq: not found` before doing anything.
   * Building the checkout is also the better dogfood — the run exercises the
   * code under review rather than the last release.
   */
  local?: boolean;
  /**
   * Emit the auto-merge step, per `RepoPolicy.autoMerge`. Off unless the repo
   * has explicitly opted in — this is the only setting that lets lurq's loop
   * change a default branch, so it is never a default.
   */
  autoMerge?: boolean;
}

export const WORKFLOW_PATH = '.github/workflows/lurq-upgrade.yml';

/**
 * The CLI spec the generated workflow pins to.
 *
 * A bare `npx -y lurqrun` resolves to whatever is newest the moment the job
 * runs, in a file that otherwise pins everything (`actions/checkout@v6`,
 * `setup-node@v4`). That makes a bad publish an incident already executing in
 * every user's CI rather than one that can be held back — and the workflow lives
 * in *their* repository, so we cannot fix it for them.
 *
 * The range admits patches and stops before the first bump that is allowed to
 * break. Pre-1.0 that bump is the minor, not the major (semver §4: "anything MAY
 * change at any time" while 0.x), so the line to hold is `0.<minor>`; from 1.0
 * the major is enough, which is the same shape as the action pins above it.
 */
export function cliSpec(version: string = VERSION): string {
  const [major = '0', minor = '0'] = version.split('.');
  return major === '0' ? `${PACKAGE_NAME}@${major}.${minor}` : `${PACKAGE_NAME}@${major}`;
}

const DEFAULT_CRON = '0 6 * * 1';
/** Daily, for a repo whose policy is advisories-only. */
const SECURITY_CRON = '0 6 * * *';

/**
 * How often the job should run, from the repo's scope.
 *
 * Weekly matches the arrival rate of breaking changes: across the index roughly
 * 7% of packages ship a major in a quarter, so a daily run on a 150-dependency
 * repo mostly spends the user's Actions minutes reporting nothing new.
 *
 * Advisories are the opposite. A weekly cron means up to seven days sitting on
 * a known CVE, which is indefensible for a repo that asked for security only —
 * that scope is a statement that this is the part they care about.
 *
 * One accessor, so the two cadences cannot drift apart across call sites.
 */
export function cronForScope(scope: 'security' | 'blocking' | 'all'): string {
  return scope === 'security' ? SECURITY_CRON : DEFAULT_CRON;
}

/** Lockfile → install command. `npm ci` needs a lockfile, so fall back to install. */
export function detectInstallCommand(lockfiles: string[]): string {
  if (lockfiles.includes('pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile';
  if (lockfiles.includes('yarn.lock')) return 'yarn install --frozen-lockfile';
  if (lockfiles.includes('bun.lockb') || lockfiles.includes('bun.lock')) return 'bun install';
  if (lockfiles.includes('package-lock.json')) return 'npm ci';
  return 'npm install';
}

export function renderWorkflow(opts: WorkflowOptions = {}): string {
  const cron = opts.cron ?? DEFAULT_CRON;
  const install = opts.installCommand ?? 'npm ci';
  const max = opts.maxUpgrades ?? 3;
  const mode = opts.mode ?? (opts.armed ? 'pr' : 'comment');
  const autoMerge = opts.autoMerge ?? false;
  // Every invocation goes through this one string: the published package, or
  // the binary this checkout builds when it IS the package.
  const cli = opts.local ? 'node dist/bin/lurq.js' : `npx -y ${cliSpec()}`;
  const buildStep = opts.local
    ? `      # This repository is lurq itself, so the run uses the CLI it builds
      # rather than the published one: npx lurqrun here would resolve to
      # this unbuilt checkout and exit 127.
      - name: Build the CLI from this checkout
        run: |
          npm ci
          npm run build

`
    : '';
  /**
   * Deliberately NOT gated on LURQ_MODE. It writes nothing, needs no API key
   * and no network to us, so it runs in analyse-only mode too — analysis is not
   * the part that needs arming. No `--exit-code` either: a repo should not
   * start failing its build the day someone connects it, and the finding is in
   * the run summary where the rest of the report already is.
   */
  const envCheck =
    opts.checkEnv === true
      ? `      - name: Check environment
        run: |
          ${cli} check-env . > lurq-env.txt
          { echo '\`\`\`'; cat lurq-env.txt; echo '\`\`\`'; } >> "$\{GITHUB_STEP_SUMMARY}"

`
      : '';

  return `# Managed by lurq, https://lurq.run
#
# Keeps this repository's dependencies current and rewrites the call sites an
# upgrade breaks. lurq has read-only access to your code, and may start this
# workflow when a dependency you declare ships a breaking release; every write
# below is made by this workflow's own GITHUB_TOKEN, scoped by the permissions
# block. Delete this file to turn the autopilot off.
name: lurq upgrade

on:
  schedule:
    - cron: "${cron}"
  workflow_dispatch:
    inputs:
      mode:
        # No default, and deliberately a string rather than a choice. GitHub
        # applies an input default on EVERY dispatch, including the ones lurq
        # sends when a new major lands — which would fill LURQ_MODE before the
        # "Resolve mode" step could read this repo's dashboard setting, and
        # silently pin every triggered run to whatever was baked in at
        # generation time. Left empty, a dispatch behaves like a scheduled run.
        description: "leave empty to use your dashboard setting; or comment / fix / pr"
        type: string
        required: false

# The blast radius. \`contents: write\` permits pushing a BRANCH; branch
# protection on your default branch is what stops anything landing unreviewed.
permissions:
  contents: write
  pull-requests: write

concurrency:
  group: lurq-upgrade-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  upgrade:
    runs-on: ubuntu-latest
    env:
      # Empty when nothing explicit set it, which the "Resolve mode" step below
      # then fills from this repository's dashboard setting. Precedence is
      # explicit first: a dispatch input, then a repository variable, then the
      # dashboard, then the mode baked in when this file was generated.
      LURQ_MODE: \${{ inputs.mode || vars.LURQ_MODE || '' }}
      MAX_UPGRADES: "${max}"
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v4
        with:
          node-version: 22

${buildStep}      # 1. What is behind, and what does each upgrade remove from its API?
      #    Sends only the dependency ranges already public in package.json.
      - name: Plan
        env:
          LURQ_API_KEY: \${{ secrets.LURQ_API_KEY }}
        run: ${cli} upgrade-plan . --json > lurq-plan.json

      # Without this the autopilot switch on the dashboard would only ever
      # affect NEW installs: lurq is Contents:read-only and cannot rewrite this
      # file or set a repository variable, so the mode is read at runtime from
      # the plan above, which already carries this repository's policy.
      #
      # Skipped entirely when something explicit already set the mode, so a
      # repository variable or a dispatch choice still wins. An older server or
      # an unconnected repo sends no mode and the baked-in '${mode}' stands.
      #
      # The value is checked against the three it may be before it reaches the
      # environment — it arrives over the network, and GITHUB_ENV is not the
      # place to trust a response.
      - name: Resolve mode
        if: env.LURQ_MODE == ''
        run: |
          MODE=$(jq -r '.mode // empty' lurq-plan.json)
          case "$MODE" in
            pr|fix|comment) ;;
            *) MODE='${mode}' ;;
          esac
          echo "LURQ_MODE=$MODE" >> "$\{GITHUB_ENV}"
          echo "Mode for this run: $MODE" >> "$\{GITHUB_STEP_SUMMARY}"

      # 2. Narrow that to symbols THIS repo references. Runs entirely locally
      #    against both versions' npm tarballs, no API key, no test suite.
      #
      #    \`--report\` is the only part that talks to us, and it is additive: it
      #    posts what this check concluded so your dashboard can show it. A
      #    missing key or an unreachable API prints a line and changes nothing
      #    else, so the gate keeps working exactly as it does without it.
      - name: Check against this codebase
        env:
          LURQ_API_KEY: \${{ secrets.LURQ_API_KEY }}
        run: ${cli} check-upgrade . --plan lurq-plan.json --report --json > lurq-brief.json

      # The same report twice: once into the run summary, once as the body of
      # the pull request. Fenced, because the report is aligned plain text and
      # markdown would otherwise collapse its indentation into one paragraph.
      - name: Summarise
        run: |
          ${cli} check-upgrade . --plan lurq-plan.json > lurq-report.txt
          { echo '\`\`\`'; cat lurq-report.txt; echo '\`\`\`'; } > lurq-report.md
          cat lurq-report.md >> "$\{GITHUB_STEP_SUMMARY}"

${envCheck}      # 3. Editing is opt-in. In 'comment' the job stops here having changed
      #    nothing, with the brief in the run summary above. 'fix' and 'pr' both
      #    continue; only 'pr' needs an Anthropic credential, which is why the
      #    check below is gated on it alone and not on editing in general.
      - name: Check agent credentials
        if: env.LURQ_MODE == 'pr'
        env:
          API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        run: |
          if [ -z "$API_KEY" ] && [ -z "$OAUTH_TOKEN" ]; then
            echo "::warning::No ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in this repository's secrets. Running the part that needs no model: the pull request will carry what lurq can prove — renamed call sites and range bumps — and the agent step is skipped. Add either secret to get the full pr mode."
            echo "LURQ_MODE=fix" >> "$\{GITHUB_ENV}"
            echo "Mode for this run: fix (pr was requested; no Anthropic credential in this repository)" >> "$\{GITHUB_STEP_SUMMARY}"
          fi

      - name: Install dependencies
        if: env.LURQ_MODE == 'pr' || env.LURQ_MODE == 'fix'
        run: ${install}

      # Everything the package itself proves, made WITHOUT a model: renamed call
      # sites, and the range bump in every manifest declaring the dependency.
      #
      # After the install, not before: bumping package.json first fails \`npm ci\`
      # outright with a lock-out-of-sync error, and the agent's own install below
      # reconciles the lockfile afterwards. It takes the same cap the agent is
      # given, so the two cannot disagree about blast radius, and it refuses
      # multi-major upgrades and unplannable sequences — the same rules the
      # prompt states below, applied by a rule instead of a model.
      - name: Apply what needs no judgement
        if: env.LURQ_MODE == 'pr' || env.LURQ_MODE == 'fix'
        run: ${cli} fix . --plan lurq-plan.json --apply --max \${{ env.MAX_UPGRADES }}

      - name: Apply upgrades
        if: env.LURQ_MODE == 'pr'
        uses: anthropics/claude-code-action@v1
        with:
          # Either credential works; set whichever you have. An API key bills
          # per token, an OAuth token uses an existing Claude Pro/Max plan.
          # Unset secrets resolve to empty and are ignored by the action.
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: |
            REPO: \${{ github.repository }}

            lurq-brief.json lists dependency upgrades this repository is behind
            on. For each entry under "breaking", the "symbolsRemoved" array names
            exports that DISAPPEAR at the target version, and each carries the
            exact file and line where this repository uses it.

            lurq-plan.json carries two more things per upgrade:
              · "declaredIn", EVERY package.json declaring that dependency.
                Bump all of them. Bumping only the root leaves a workspace
                pinned to the old major, which typechecks and breaks on install.
              · "hops", the migration sequence when the upgrade crosses two or
                more majors, with what each step removes. Work the steps in
                order; do not jump straight to the target version. When
                "sequenceNote" is present, the sequence could not be planned,
                treat that dependency as a migration and skip it.

            A step before you has ALREADY APPLIED every change lurq could
            prove: renamed call sites where the package itself proves the
            replacement, and the range bump in every manifest for those
            upgrades. Read the files before assuming any of it is undone — you
            cannot run git, so the working tree is the only record. Your job is
            what remains, and re-doing applied work risks reverting it.

            Take at most \${{ env.MAX_UPGRADES }} entries, hardest first:

            1. Bump the dependency's range in every manifest listed in
               "declaredIn", where that has not been done already.
            2. Run \`${install.split(' ')[0]} install\` so node_modules holds the
               TARGET version. Until you do, the package on disk is the old one
               and anything you read from it describes the API you are leaving.
            3. Rewrite every listed call site. A removed symbol carrying
               "renamedTo" has a replacement the package itself proves: at the
               old version both names were exported from the same function, so
               rename the call. Under "arityChanged", "callsBroken" names each
               call whose argument count the new version no longer accepts, and
               "unmeasured" names uses to read by hand. "typeErrors" lists the
               compiler errors the new version introduces, at file and line;
               after installing, \`tsc\` should report none of them.
               "entriesRemoved" names deep imports the new version no longer
               offers, and "moduleFormat" names require() uses that break
               because the package is now an ES module. "requirements" names a
               Node or peer version the new release needs and this repository
               lacks: do not bump past it. For removed symbols
               without "renamedTo", "newExports" on each entry names
               the exports the target version ADDED, extracted from its shipped
               JavaScript: that is where the replacement for a removed symbol
               comes from. Confirm each one against the freshly installed package
               under node_modules before you call it. You have NO network access
               and no documentation: an API in neither the brief nor node_modules
               is one you cannot verify, and writing it anyway is the failure
               this whole job exists to prevent. Revert that dependency instead.
            4. Run the repository's test script. If it fails and you cannot fix
               it from the upgrade itself, revert that dependency and move on,
               a reverted upgrade is a fine outcome, a broken build is not.
            5. Leave the working tree with only the upgrades that pass.

            Do not touch unrelated files. Do not change CI configuration. Do not
            run git commands: the workflow handles version control.
          claude_args: |
            --allowedTools "Read,Edit,Write,Bash(${install.split(' ')[0]}:*)"

      # The repository's own git hooks belong to a person committing from a
      # terminal. Here they run against a bot commit with nothing interactive
      # available, and a husky or lint-staged hook — installed by the step
      # above, not present in the checkout before it — fails the one commit
      # this whole job exists to make.
      - name: Ignore local git hooks for this commit
        if: env.LURQ_MODE == 'pr' || env.LURQ_MODE == 'fix'
        run: git config core.hooksPath /dev/null

      # 4. The workflow does version control, never the model.
      - name: Open pull request
        id: pr
        if: env.LURQ_MODE == 'pr' || env.LURQ_MODE == 'fix'
        uses: peter-evans/create-pull-request@v7
        with:
          branch: lurq/upgrades
          title: "chore(deps): lurq dependency upgrades"
          commit-message: "chore(deps): upgrade dependencies and migrate call sites"
          # The rendered report, not the raw JSON. A reviewer opening this PR
          # reads what was removed and where it is used; the JSON is the agent's
          # input, and pasting it here made the case for the change unreadable.
          body-path: lurq-report.md
          labels: dependencies
          delete-branch: true
${autoMerge ? MERGE_STEP : ''}`;
}

/**
 * Auto-merge, emitted only when the repo's policy opts in.
 *
 * `--auto` is the load-bearing flag: it asks GitHub to merge **when the repo's
 * own required checks pass**, rather than merging now. lurq does not evaluate
 * anyone's CI and must never be the thing that decides a build was good enough —
 * branch protection stays the authority, and on a repo without it this is a
 * no-op that leaves the PR open rather than a silent landing.
 *
 * Emitting the step only under the policy — instead of always emitting it behind
 * an `if:` — means a user who has not opted in can read their own workflow file
 * and see that nothing in it can merge. The trust model is legible from the file
 * itself, which is the same reason the user commits it by hand.
 */
const MERGE_STEP = `
      # 5. Auto-merge, per this repository's lurq policy. GitHub merges only
      #    once the repo's OWN required checks pass; lurq never makes that call.
      #    Requires "Allow auto-merge" in repository settings.
      - name: Enable auto-merge
        if: (env.LURQ_MODE == 'pr' || env.LURQ_MODE == 'fix') && steps.pr.outputs.pull-request-number
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh pr merge --auto --squash "\${{ steps.pr.outputs.pull-request-number }}"
`;

/**
 * GitHub's prefilled new-file URL. The dashboard links here instead of lurq
 * opening the PR itself — the user sees the exact file before committing it, and
 * lurq keeps zero write scope.
 */
export function newFileUrl(fullName: string, branch: string, content: string): string {
  const params = new URLSearchParams({ filename: WORKFLOW_PATH, value: content });
  return `https://github.com/${fullName}/new/${encodeURIComponent(branch)}?${params.toString()}`;
}
