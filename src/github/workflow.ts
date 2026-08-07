/**
 * The workflow file a user commits to arm the autopilot.
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

  return `# Managed by lurq — https://lurq.run
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
      #    against both versions' npm tarballs — no API key, no test suite.
      - name: Check against this codebase
        run: npx -y lurqrun check-upgrade . --plan lurq-plan.json --json > lurq-brief.json

      - name: Summarise
        run: npx -y lurqrun check-upgrade . --plan lurq-plan.json >> "$\{GITHUB_STEP_SUMMARY}"

      # 3. Editing is opt-in. Until LURQ_MODE is 'pr', the job stops here having
      #    changed nothing — the brief is in the run summary above.
      - name: Install dependencies
        if: env.LURQ_MODE == 'pr'
        run: ${install}

      - name: Apply upgrades
        if: env.LURQ_MODE == 'pr'
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            REPO: \${{ github.repository }}

            lurq-brief.json lists dependency upgrades this repository is behind
            on. For each entry under "breaking", the "symbolsRemoved" array names
            exports that DISAPPEAR at the target version, and each carries the
            exact file and line where this repository uses it.

            Take at most \${{ env.MAX_UPGRADES }} entries, hardest first:

            1. Bump the dependency's range in the package.json that declares it.
            2. Rewrite every listed call site to the target version's API. The
               brief tells you what was removed; consult the package's own docs
               for the replacement. Do not invent an API you have not verified.
            3. Run the repository's test script. If it fails and you cannot fix
               it from the upgrade itself, revert that dependency and move on —
               a reverted upgrade is a fine outcome, a broken build is not.
            4. Leave the working tree with only the upgrades that pass.

            Do not touch unrelated files. Do not change CI configuration. Do not
            run git commands — the workflow handles version control.
          claude_args: |
            --allowedTools "Read,Edit,Write,Bash(${install.split(' ')[0]}:*)"

      # 4. The workflow does version control, never the model.
      - name: Open pull request
        if: env.LURQ_MODE == 'pr'
        uses: peter-evans/create-pull-request@v7
        with:
          branch: lurq/upgrades
          title: "chore(deps): lurq dependency upgrades"
          commit-message: "chore(deps): upgrade dependencies and migrate call sites"
          body-path: lurq-brief.json
          labels: dependencies
          delete-branch: true
`;
}

/**
 * GitHub's prefilled new-file URL. The dashboard links here instead of lurq
 * opening the PR itself — the user sees the exact file before committing it, and
 * lurq keeps zero write scope.
 */
export function newFileUrl(fullName: string, branch: string, content: string): string {
  const params = new URLSearchParams({ filename: WORKFLOW_PATH, value: content });
  return `https://github.com/${fullName}/new/${encodeURIComponent(branch)}?${params.toString()}`;
}
