/**
 * The one-paste setup brief for the autopilot, for one repository or thirty.
 *
 * It delegates every write to `lurq autopilot init`, which sets the secret,
 * commits the workflow with the user's own `gh` auth and starts the first run.
 * The brief never inlines the workflow YAML: the command renders it from the
 * repository itself, and a copy pasted into a chat drifts from the template the
 * moment the template changes.
 *
 * A key is embedded only when one was minted for this copy, and the brief then
 * says outright that it is live. What makes that defensible: the key is
 * SCOPE-LESS (`KEY_SCOPES` holds only `policy:write`, so it cannot rewrite the
 * rules agents are held to), labelled, and revocable.
 */

export type SetupMode = "comment" | "fix" | "pr";

export interface SetupInput {
  /** `owner/name` of every repository to set up. */
  repos: string[];
  /** The most capable mode among them: `pr` decides whether a credential is needed. */
  mode: SetupMode;
  /** Where the user revokes the key. Absolute, so an agent can follow it. */
  keysUrl: string;
  /** A freshly minted, scope-less key. Absent: the command uses the stored one. */
  apiKey?: string;
}

/** The command itself, shared by the brief and the "copy terminal command" button. */
export function setupCommand({ repos, mode }: Pick<SetupInput, "repos" | "mode">): string {
  return `npx lurqrun autopilot init --mode ${mode} --repo ${repos.join(" ")}`;
}

export function setupPrompt(input: SetupInput): string {
  const { repos, mode, keysUrl, apiKey } = input;
  // An agent cannot complete `claude setup-token`'s browser sign-in, so in pr
  // mode it skips that and asks for the credential instead of hanging on it.
  const command = setupCommand(input) + (mode === "pr" ? " --no-credential" : "");
  const noun = repos.length === 1 ? "repository" : `${repos.length} repositories`;

  const lines = [
    `Set up lurq's dependency autopilot on ${noun}: ${repos.join(", ")}.`,
    "",
    "Do these in order. Stop and tell me if a step needs something you cannot do.",
    "",
    "1. Check the GitHub CLI: run `gh auth status`.",
    "   · Not installed or not signed in: ask me to run `gh auth login`.",
    "   · The token scopes line lacks 'workflow': ask me to run `gh auth refresh -s workflow`. GitHub refuses to write workflow files without it.",
    "",
    apiKey
      ? "2. Run this, with LURQ_API_KEY set to the value at the end of this message. It is a LIVE credential for my lurq account: pass it as an environment variable, never echo it, never write it to a file, never commit it."
      : "2. Run this. It uses the lurq key stored on this machine; if it says there is none, ask me to run `npx lurqrun setup`.",
    `   ${apiKey ? "LURQ_API_KEY=<key> " : ""}${command}`,
    "",
    "   For each repository it sets the LURQ_API_KEY secret, commits .github/workflows/lurq-upgrade.yml to the default branch, and starts the first run. A protected branch gets a pull request instead. Do not edit the workflow it writes.",
  ];

  if (mode === "pr") {
    lines.push(
      "",
      "3. pr mode runs an agent in CI and needs an Anthropic credential in every repository. Ask me for an ANTHROPIC_API_KEY (from the Anthropic console, does not expire) and set it per repository, reading the value from stdin:",
      ...repos.map((r) => `   gh secret set ANTHROPIC_API_KEY --repo ${r}`),
      "   A Claude Pro/Max token from `claude setup-token` works too as CLAUDE_CODE_OAUTH_TOKEN, but it EXPIRES ONE YEAR after creation with no warning.",
    );
  }

  lines.push(
    "",
    "Then show me the command's summary: which repositories were committed, which got a pull request (link them, I merge those), and which failed and why.",
  );

  if (apiKey) {
    lines.push("", `--- LURQ_API_KEY (live credential; revoke at ${keysUrl}) ---`, apiKey);
  }
  return lines.join("\n");
}
