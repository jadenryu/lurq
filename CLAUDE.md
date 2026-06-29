# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in the lurq repository.

## Project

lurq is a continuously-updated, evidence-scored index of JS/TS frameworks and
libraries, exposed as an MCP server, CLI (`lurq`, published as `lurqrun`), and
agent skill. Its core value is **typosquat detection** and **anti-hallucination
ranking** — scrutinize any change to those paths hardest.

- Source: `src/` (TypeScript, ESM). Tests: `tests/` (vitest).
- Gates: `npm run typecheck`, `npm run lint`, `npm test`.

## Automated agent loop — `scripts/agent-loop/`

This directory is an **automated, bounded task loop**, not ordinary app code.
What it does and the rules around it:

- It derives tasks only from mechanical sources you control (the
  `vault/backlog.md` checklist by default; optionally `TODO`/`FIXME` comments or
  failing tests). It never invents open-ended work.
- Each task runs in an isolated git worktree off `main`. `main` is never checked
  out or modified by the loop.
- The deterministic gates (`typecheck`, `lint`, `test`) are the real review
  gate. A PR is opened **only** when every gate passes.
- **Every PR it opens is a draft** labelled `agent-generated` and **requires
  human review before merge.** It never merges and never pushes to `main`.
- It is **safe by default**: `DRY_RUN` defaults to true, so a plain
  `npm run agent:loop` opens no PRs — it only writes audit notes to
  `vault/tasks/`. Going live (`DRY_RUN=false`) is a deliberate human step.
- **Kill switch:** create a `.agent-loop-stop` file at the repo root to halt the
  loop immediately. It is gitignored (local-only).
- An independent GitHub Action (`.github/workflows/claude-pr-review.yml`)
  reviews every PR — including the loop's own — with a fresh context.

The audit trail lives in `vault/` (Obsidian-readable: one note per task with
frontmatter + wikilinks). Those notes ARE tracked; do not gitignore them.
