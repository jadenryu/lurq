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
 *   · The API key is NEVER embedded. This text gets pasted into a chat log, a
 *     transcript, sometimes a screenshot. `create-key-dialog` already tells
 *     people not to paste a policy-writing key into an agent; a prompt that
 *     bakes any key in would undo that advice at the one moment they are most
 *     likely to follow it. The brief asks the agent to ask.
 *   · It never instructs the agent to commit on the user's behalf without
 *     saying so. Committing this file is what grants write access, so the brief
 *     tells the agent to show the diff and stop.
 */

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
}: AgentSetupInput): string {
  const needsAgentCredential = mode === "pr";

  const lines = [
    `Set up lurq's dependency autopilot on ${repoFullName}. lurq tells us which upgrades break code this repo actually references, then this workflow acts on it in our own GitHub Actions.`,
    "",
    "Do these in order. Stop and ask me if a step needs something you do not have.",
    "",
    `1. Ask me for a lurq API key and do not guess or reuse one from another project. I create it at ${keysUrl}. Never print it back to me, never write it into a file, and never put it in a commit.`,
    "",
    `2. Set it as a repository secret:`,
    `   gh secret set LURQ_API_KEY --repo ${repoFullName}`,
    `   That command reads the value from stdin, so it never lands in my shell history.`,
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

  return lines.join("\n");
}
