#!/usr/bin/env node
// Bounded autonomous task loop for lurq. SAFE BY DEFAULT.
//
// For each task from a mechanical source it: creates an isolated git worktree off
// the base branch (main is never checked out here), runs Claude Code headless to
// do the work, runs the project's own gates, opens a DRAFT PR only if every gate
// is green, and writes an Obsidian note for every task. It never merges, never
// pushes to the base branch, and stops if the kill-switch file exists.
//
// Run:   node scripts/agent-loop/run.mjs           # dry run, opens no PRs
//        DRY_RUN=false MAX_TASKS=2 node scripts/agent-loop/run.mjs

import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTasks } from './task-sources.mjs';
import { writeVaultNote } from './vault-note.mjs';

// ---- Guardrails (override via env) ----------------------------------------
const DRY_RUN     = process.env.DRY_RUN !== 'false';      // default true: open no PRs
const MAX_TASKS   = Number(process.env.MAX_TASKS ?? 3);   // hard cap per run
const BASE_BRANCH = process.env.BASE_BRANCH ?? 'main';
const MODEL       = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
const VAULT_DIR   = process.env.VAULT_DIR ?? 'vault/tasks';
const STOP_FILE   = '.agent-loop-stop';                   // create this to halt everything
// Gate commands must map to real scripts in your package.json. A missing/failing
// gate => no PR (fail safe). Override per project.
const GATES = [
  ['typecheck', process.env.GATE_TYPECHECK ?? 'npm run -s typecheck'],
  ['lint',      process.env.GATE_LINT      ?? 'npm run -s lint'],
  ['test',      process.env.GATE_TEST      ?? 'npm test --silent'],
];

const sh = (cmd, opts = {}) =>
  execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
const abort = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

// ---- Preflight ------------------------------------------------------------
if (existsSync(STOP_FILE)) abort(`kill switch present (${STOP_FILE}) — remove it to run`);
for (const bin of ['git', 'gh', 'claude', 'npm'])
  try { sh(`command -v ${bin}`); } catch { abort(`'${bin}' not found on PATH`); }

const repoRoot = sh('git rev-parse --show-toplevel');
process.chdir(repoRoot);

const tasks = (await getTasks()).slice(0, MAX_TASKS);
if (tasks.length === 0) { console.log('No tasks from source. Nothing to do.'); process.exit(0); }
console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Processing ${tasks.length} task(s) ` +
            `(cap ${MAX_TASKS}) with ${MODEL}\n`);

// ---- Per-task loop --------------------------------------------------------
for (const task of tasks) {
  const branch = `agent/${task.id}`;
  const worktree = mkdtempSync(join(tmpdir(), `lurq-${task.id}-`));
  const r = { ...task, branch, status: 'failed', prUrl: null, gates: {}, filesTouched: [], summary: '' };

  try {
    sh(`git fetch origin ${BASE_BRANCH} --quiet || true`);
    sh(`git worktree add -B ${branch} "${worktree}" ${BASE_BRANCH}`);

    const prompt = [
      `Task: ${task.title}`,
      task.body ? `Details: ${task.body}` : '',
      '',
      'Constraints:',
      '- Make the smallest change that fully resolves the task. Do not refactor unrelated code.',
      '- Follow CLAUDE.md and the existing codebase conventions.',
      '- Do NOT merge, push, or modify CI, secrets, or the base branch.',
      '- End by printing a 2-3 sentence summary of what you changed and why.',
    ].filter(Boolean).join('\n');

    // Tight tool allowlist. Confirm exact flag names with `claude -p --help` —
    // they're stable but worth a glance on first setup.
    const allowed = [
      'Read', 'Edit', 'Write', 'Grep', 'Glob',
      'Bash(npm run *)', 'Bash(npm test*)', 'Bash(npx tsc*)',
      'Bash(git add*)', 'Bash(git commit*)', 'Bash(git status*)', 'Bash(git diff*)',
    ].join(',');

    console.log(`→ [${task.id}] ${task.title}`);
    const out = execFileSync('claude', [
      '-p', prompt,
      '--model', MODEL,
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', allowed,
      '--disallowedTools', 'Bash(rm *),Bash(curl *),Bash(git push*),WebFetch,WebSearch',
    ], { cwd: worktree, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

    try { r.summary = String(JSON.parse(out).result ?? '').slice(0, 600); }
    catch { r.summary = out.slice(0, 600); }

    // Backstop commit in case Claude left changes uncommitted.
    if (sh('git status --porcelain', { cwd: worktree })) {
      sh('git add -A', { cwd: worktree });
      sh(`git commit -m ${JSON.stringify('agent: ' + task.title)} --quiet`, { cwd: worktree });
    }
    r.filesTouched = sh(`git diff --name-only ${BASE_BRANCH}...HEAD`, { cwd: worktree })
      .split('\n').filter(Boolean);

    if (r.filesTouched.length === 0) {
      r.status = 'no-op';
      console.log('  · no changes produced — skipping PR');
    } else {
      // ---- Deterministic gates: the REAL reviewers ----
      for (const [name, cmd] of GATES) {
        try { sh(cmd, { cwd: worktree }); r.gates[name] = 'pass'; }
        catch { r.gates[name] = 'fail'; }
      }
      const green = Object.values(r.gates).every((v) => v === 'pass');

      if (!green) {
        r.status = 'gates-failed';
        console.log(`  ✗ gates failed: ${JSON.stringify(r.gates)} — no PR opened`);
      } else if (DRY_RUN) {
        r.status = 'dry-run-green';
        console.log('  ✓ gates green (dry run) — would open a draft PR');
      } else {
        sh(`git push -u origin ${branch} --quiet`, { cwd: worktree });
        const prBody =
          `Automated by the lurq agent loop.\n\n` +
          `**Task:** ${task.title}\n**Source:** ${task.source}\n\n` +
          `${r.summary}\n\n**Gates:** ${JSON.stringify(r.gates)}\n\n` +
          `> ⚠️ Human review required before merge.`;
        r.prUrl = sh(
          `gh pr create --base ${BASE_BRANCH} --head ${branch} ` +
          `--title ${JSON.stringify('agent: ' + task.title)} ` +
          `--body ${JSON.stringify(prBody)} --label agent-generated --draft`,
          { cwd: worktree });
        r.status = 'pr-open';
        console.log(`  ✓ draft PR opened: ${r.prUrl}`);
      }
    }
  } catch (err) {
    r.status = 'error';
    r.summary = String(err.stderr || err.message || err).slice(0, 600);
    console.log(`  ✗ error: ${r.summary.split('\n')[0]}`);
  } finally {
    writeVaultNote(VAULT_DIR, r);
    try { sh(`git worktree remove "${worktree}" --force`); } catch {}
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
  }
}

console.log(`\nDone. Notes in ${VAULT_DIR}/. Open the vault in Obsidian to audit the graph.`);
