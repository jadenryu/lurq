/**
 * The setup brief a user hands to their coding agent.
 *
 * Setting the autopilot up by hand is four context switches: create a key in the
 * dashboard, run a CLI, create a file on GitHub, add secrets in repository
 * settings. An agent with a shell and `gh` can do all of it, and the audience
 * for this product is already sitting in front of one.
 *
 * Pure, and assembled on the server, for the reason `CopyButton` states: the
 * payload is built where the data already is, so a client component never
 * becomes a second source of truth for what the page says.
 *
 * TWO RULES, both about not making things worse:
 *
 *   · A key is embedded ONLY when one was minted for this copy, and the brief
 *     then says outright that it is live. It started as "never embed", and that
 *     is still the default every caller gets; onboarding mints one because the
 *     alternative was a dashboard visit in the middle of an agent flow, which
 *     is the friction this exists to remove. What makes it defensible is that
 *     the key is SCOPE-LESS — `KEY_SCOPES` holds only `policy:write`, so a key
 *     without it cannot rewrite the rules agents are held to — and that it is
 *     labelled and revocable. `create-key-dialog`'s warning is about
 *     policy-writing keys specifically, and this is not one.
 *   · It never instructs the agent to commit on the user's behalf without
 *     saying so. Committing this file is what grants write access, so the brief
 *     tells the agent to show the diff and stop.
 */

/** What an agent needs to set lurq up across an account. */
export interface AccountSetupInput {
  /** `owner/name` for each connected repo, so the agent works a known list. */
  repos: string[];
  /** Where keys are created and revoked. Absolute: an agent cannot follow a path. */
  keysUrl: string;
  /** A freshly minted, scope-less key to carry inline. Absent means ask. */
  apiKey?: string;
  /** Repos GitHub has that lurq has not seen, so the brief can say so. */
  unconnected?: number;
}

/**
 * The whole setup, as one brief an agent can execute.
 *
 * The per-repo version below hands over a rendered workflow because the
 * dashboard has one. This cannot: there is no file until a repo is connected,
 * and a generic one would lose each repo's package manager. So it delegates to
 * `lurq autopilot-init`, which renders locally from the lockfile on disk — that
 * command exists precisely so this prompt can be written.
 *
 * What an agent genuinely cannot do is listed at the end rather than silently
 * omitted. Installing the GitHub App is a consent step on GitHub's own domain,
 * and committing the workflow is what grants write access to the repository.
 * A brief that quietly did either would be doing the two things a person should
 * decide, and the value here is removing clicks that carry no decision.
 */
export function accountSetupPrompt({
  repos,
  keysUrl,
  apiKey,
  unconnected = 0,
}: AccountSetupInput): string {
  const many = repos.length !== 1;
  const list = repos.length
    ? repos.map((r) => `   · ${r}`)
    : ['   · (none connected yet — I install the GitHub App first)'];

  const lines = [
    `Set lurq's dependency autopilot up across my repositories. lurq says which upgrades break code a repo actually references; the workflow you are about to write acts on that in my own GitHub Actions.`,
    "",
    `Repositories to set up (${repos.length}):`,
    ...list,
    "",
    "Work one repository at a time. Stop and ask me if a step needs something you do not have.",
    "",
    apiKey
      ? `1. The lurq API key is at the end of this message under LURQ_API_KEY. It is a LIVE credential for my account — do not echo it, do not write it into a file, and do not commit it. I revoke it at ${keysUrl} if it leaks.`
      : `1. Ask me for a lurq API key; I create it at ${keysUrl}. Do not guess one or reuse one from another project.`,
    "",
    `2. Wire this machine up once, so my agents can query the index directly:`,
    `      npx lurqrun setup --yes --api-key <the key>`,
    "",
    `3. In each repository above, from inside its checkout:`,
    `      npx lurqrun autopilot-init`,
    `   It detects the package manager from the lockfile and writes`,
    `   .github/workflows/lurq-upgrade.yml. It refuses to overwrite an existing`,
    `   one — do not pass --force without telling me. Do not hand-edit the`,
    `   permissions block: it is the trust boundary and it is deliberately minimal.`,
    "",
    `4. Set the key as a repository secret in each one. Run it from inside the`,
    `   checkout so gh resolves the repository itself, and let it read the value`,
    `   from stdin rather than passing it as an argument, so it stays out of my`,
    `   shell history:`,
    `      gh secret set LURQ_API_KEY`,
    "",
    `5. Show me the diff for each repository and STOP. Do not push and do not open`,
    `   pull requests. Committing that file is what grants write access to the`,
    `   repository, so I read it before it lands.`,
    "",
    `What you cannot do, and I will:`,
    `   · install the lurq GitHub App (a consent step on github.com)`,
    `   · commit the workflow files you wrote`,
    unconnected > 0
      ? `   · connect ${unconnected} repositor${unconnected === 1 ? 'y' : 'ies'} lurq has not seen yet`
      : `   · connect any further repositories later`,
    "",
    `The file starts in fix mode: it opens pull requests containing only changes`,
    `lurq can prove — renamed call sites, and the range bump in every manifest —`,
    `with no model involved and no Anthropic credential needed. Each run reads the`,
    `mode from my dashboard, so switching it later needs no change to the file.`,
    "",
    `When you are done, tell me in one line per repository what you wrote and what`,
    `is left for me${many ? '' : ''}.`,
  ];

  if (apiKey) {
    lines.push("", "--- LURQ_API_KEY (live credential, step 1) ---", apiKey);
  }

  return lines.join("\n");
}

/** What an agent needs to finish setup for one repository. */
export interface AgentSetupInput {
  /** `owner/name`, so the `gh` commands are unambiguous in a multi-repo shell. */
  repoFullName: string;
  /** Where the workflow goes, from the server constant rather than retyped. */
  workflowPath: string;
  /** The rendered workflow, already carrying this repo's package manager and mode. */
  workflow: string;
  /** The mode this repo's policy resolves to — decides whether a key is needed. */
  mode: "comment" | "fix" | "pr";
  /** Where to create an API key. Passed in so the URL is not spelled twice. */
  keysUrl: string;
  /**
   * A freshly minted, scope-less lurq key to carry inline.
   *
   * ABSENT BY DEFAULT, and the brief then tells the agent to ask — which is
   * what every caller did before onboarding started minting one. When present
   * the prompt says outright that it carries a live credential, because the
   * text lands in a chat transcript and the reader has to know that.
   *
   * Scope-less on purpose: `KEY_SCOPES` has exactly one entry, `policy:write`,
   * and a key without it cannot rewrite the rules agents are held to. That is
   * what makes embedding one defensible at all.
   */
  apiKey?: string;
}

/**
 * The agent-facing brief, as plain text.
 *
 * Numbered because an agent following prose skips steps, and the order matters:
 * the key has to exist before the workflow can run, and the file has to be
 * committed before a secret is worth anything.
 */
export function agentSetupPrompt({
  repoFullName,
  workflowPath,
  workflow,
  mode,
  keysUrl,
  apiKey,
}: AgentSetupInput): string {
  const needsAgentCredential = mode === "pr";

  // Two shapes for step 1. With a minted key the human does nothing; without
  // one the brief asks, which is what it always did and what the per-repo panel
  // still uses when nothing was minted.
  const keyStep = apiKey
    ? [
        `1. Set lurq's API key as a repository secret. The value is at the end of this message, under LURQ_API_KEY. It is a LIVE credential for my lurq account — do not echo it, do not write it into a file, and do not commit it. If it ever leaks, I revoke it at ${keysUrl}.`,
        "",
        `2. Set it with the value read from stdin rather than passed as an argument, so it does not land in my shell history:`,
        `   gh secret set LURQ_API_KEY --repo ${repoFullName}`,
        `   Paste the key when it asks for the value.`,
      ]
    : [
        `1. Ask me for a lurq API key and do not guess or reuse one from another project. I create it at ${keysUrl}. Never print it back to me, never write it into a file, and never put it in a commit.`,
        "",
        `2. Set it as a repository secret:`,
        `   gh secret set LURQ_API_KEY --repo ${repoFullName}`,
        `   That command reads the value from stdin, so it never lands in my shell history.`,
      ];

  const lines = [
    `Set up lurq's dependency autopilot on ${repoFullName}. lurq tells us which upgrades break code this repo actually references, then this workflow acts on it in our own GitHub Actions.`,
    "",
    "Do these in order. Stop and ask me if a step needs something you do not have.",
    "",
    ...keyStep,
    "",
    `3. Create ${workflowPath} with exactly the content at the end of this message. Do not reformat it, do not "improve" the cron, and do not change the permissions block — that block is the whole trust boundary and it is deliberately minimal.`,
    "",
    `4. Show me the diff and stop. Do not push. Committing this file is what grants write access to my repository, so I want to read it before it lands.`,
  ];

  if (needsAgentCredential) {
    lines.push(
      "",
      `5. This repo is set to pr mode, which runs an agent in CI and needs an Anthropic credential. Ask me which I want and set it the same way as step 2:`,
      `   · CLAUDE_CODE_OAUTH_TOKEN — I run \`claude setup-token\` locally and paste what it prints. Works with a Claude Pro or Max plan. IT EXPIRES ONE YEAR AFTER CREATION, with no warning, and this is a scheduled job: tell me that when you set it.`,
      `   · ANTHROPIC_API_KEY — from the Anthropic console. Does not expire, bills per token, and is the right one if more than one person maintains this repo.`,
      "",
      `   Without one of those the job analyses correctly and then fails at the credential check, which looks like a lurq bug and is not.`,
    );
  } else {
    lines.push(
      "",
      `5. No Anthropic credential is needed. This repo is set to ${mode} mode: ${
        mode === "fix"
          ? "it opens pull requests containing only the changes lurq can prove — renamed call sites and the range bump in every manifest — with no model involved."
          : "it analyses and writes a brief to the run summary, changing nothing."
      }`,
    );
  }

  lines.push(
    "",
    "Afterwards, tell me in one line what you set and what I still have to do myself.",
    "",
    `--- ${workflowPath} ---`,
    workflow.trimEnd(),
  );

  // Last, and labelled, so it is obvious what this block is and easy to strip
  // before pasting the rest anywhere. Putting it at the top would bury the
  // instructions under a secret.
  if (apiKey) {
    lines.push("", "--- LURQ_API_KEY (live credential, step 2) ---", apiKey);
  }

  return lines.join("\n");
}
