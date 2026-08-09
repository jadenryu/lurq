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
 * GitHub App is Contents:read-only and can never write to anyone's repository.
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
 */

export interface WorkflowOptions {
  /** Cron schedule. Default: Mondays 06:00 UTC. */
  cron?: string;
  /** Start in `pr` mode instead of the analyse-only default. */
  armed?: boolean;
  /** Package manager install command, detected from the lockfile. */
  installCommand?: string;
  /** Max upgrades attempted per run — the blast-radius cap. */
  maxUpgrades?: number;
  /**
   * Emit the auto-merge step, per `RepoPolicy.autoMerge`. Off unless the repo
   * has explicitly opted in — this is the only setting that lets lurq's loop
   * change a default branch, so it is never a default.
   */
  autoMerge?: boolean;
}

export const WORKFLOW_PATH = '.github/workflows/lurq-upgrade.yml';

const DEFAULT_CRON = '0 6 * * 1';

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
  const mode = opts.armed ? 'pr' : 'comment';
  const autoMerge = opts.autoMerge ?? false;

  return `# Managed by lurq, https://lurq.run
#
# Keeps this repository's dependencies current and rewrites the call sites an
# upgrade breaks. lurq itself has read-only access to your code; every write
# below is made by this workflow's own GITHUB_TOKEN, scoped by the permissions
# block. Delete this file to turn the autopilot off.
name: lurq upgrade

on:
  schedule:
    - cron: "${cron}"
  workflow_dispatch:
    inputs:
      mode:
        description: "comment = analyse only · pr = open pull requests"
        type: choice
        options: [comment, pr]
        default: ${mode}

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
      LURQ_MODE: \${{ inputs.mode || vars.LURQ_MODE || '${mode}' }}
      MAX_UPGRADES: "${max}"
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # 1. What is behind, and what does each upgrade remove from its API?
      #    Sends only the dependency ranges already public in package.json.
      - name: Plan
        env:
          LURQ_API_KEY: \${{ secrets.LURQ_API_KEY }}
        run: npx -y lurqrun upgrade-plan . --json > lurq-plan.json

      # 2. Narrow that to symbols THIS repo references. Runs entirely locally
      #    against both versions' npm tarballs, no API key, no test suite.
      - name: Check against this codebase
        run: npx -y lurqrun check-upgrade . --plan lurq-plan.json --json > lurq-brief.json

      # The same report twice: once into the run summary, once as the body of
      # the pull request. Fenced, because the report is aligned plain text and
      # markdown would otherwise collapse its indentation into one paragraph.
      - name: Summarise
        run: |
          npx -y lurqrun check-upgrade . --plan lurq-plan.json > lurq-report.txt
          { echo '\`\`\`'; cat lurq-report.txt; echo '\`\`\`'; } > lurq-report.md
          cat lurq-report.md >> "$\{GITHUB_STEP_SUMMARY}"

      # 3. Editing is opt-in. Until LURQ_MODE is 'pr', the job stops here having
      #    changed nothing, the brief is in the run summary above, and no
      #    Anthropic credential is needed to get this far.
      - name: Check agent credentials
        if: env.LURQ_MODE == 'pr'
        env:
          API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        run: |
          if [ -z "$API_KEY" ] && [ -z "$OAUTH_TOKEN" ]; then
            echo "::error::pr mode needs one of ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in this repository's secrets. A Claude Pro/Max subscription token works for the latter. Set LURQ_MODE=comment to run analysis only."
            exit 1
          fi

      - name: Install dependencies
        if: env.LURQ_MODE == 'pr'
        run: ${install}

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

            Take at most \${{ env.MAX_UPGRADES }} entries, hardest first:

            1. Bump the dependency's range in every manifest listed in
               "declaredIn".
            2. Run \`${install.split(' ')[0]} install\` so node_modules holds the
               TARGET version. Until you do, the package on disk is the old one
               and anything you read from it describes the API you are leaving.
            3. Rewrite every listed call site. "newExports" on each entry names
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

      # 4. The workflow does version control, never the model.
      - name: Open pull request
        id: pr
        if: env.LURQ_MODE == 'pr'
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
        if: env.LURQ_MODE == 'pr' && steps.pr.outputs.pull-request-number
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
