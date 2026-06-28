// Mechanical task sources. The agent NEVER invents open-ended work — it only
// derives tasks from concrete signals you control. Pick sources with the
// TASK_SOURCE env var (comma-separated): "queue" (default), "todos",
// "failing-tests". Each returns { id, source, title, body }.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const CAP = 20; // never derive more than this many tasks from any one source

// 1) APPROVED QUEUE (default, safest): a markdown checklist YOU maintain. Only
//    unchecked "- [ ]" items become tasks. This is the human-in-the-loop source
//    — the agent literally cannot work on anything you haven't written down.
function fromQueue() {
  const file = process.env.QUEUE_FILE ?? 'vault/backlog.md';
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n')
    .filter((l) => /^\s*-\s\[ \]\s+/.test(l))
    .slice(0, CAP)
    .map((l, i) => {
      const title = l.replace(/^\s*-\s\[ \]\s+/, '').trim();
      return { id: `queue-${i + 1}-${slug(title)}`, source: 'queue', title, body: '' };
    });
}

// 2) TODO / FIXME comments in src/ -> one task each. Mechanically derived, so
//    scope stays anchored to things already flagged in the code.
function fromTodos() {
  let hits = '';
  try { hits = sh(`git grep -nE "(TODO|FIXME)" -- 'src/**' || true`); } catch {}
  return hits.split('\n').filter(Boolean).slice(0, CAP).map((line, i) => {
    const text = line.replace(/^.*?(TODO|FIXME):?\s*/, '').slice(0, 100);
    const where = line.split(':').slice(0, 2).join(':');
    return { id: `todo-${i + 1}-${slug(text)}`, source: 'todos',
             title: `Resolve TODO: ${text}`, body: `Location: ${where}` };
  });
}

// 3) FAILING TESTS -> one fix task each. Requires JSON test output. lurq uses
//    vitest, whose JSON reporter is Jest-compatible: a top-level `testResults`
//    array (one entry per file, with `name` + `status`) that nests an
//    `assertionResults` array (one entry per test case, with `fullName` +
//    `status`). We drill into the individual failing assertions so each derived
//    task targets a single test, with the file path captured as its location.
function fromFailingTests() {
  try {
    const cmd = process.env.TEST_JSON_CMD ?? 'vitest run --reporter=json';
    const raw = sh(`${cmd} || true`);
    const json = JSON.parse(raw.slice(raw.indexOf('{')));
    const failed = [];
    for (const file of json.testResults ?? []) {
      for (const a of file.assertionResults ?? []) {
        if (a.status === 'failed') failed.push({ name: a.fullName ?? a.title, file: file.name });
      }
    }
    return failed.slice(0, CAP).map((t, i) => ({
      id: `failtest-${i + 1}-${slug(t.name ?? String(i))}`, source: 'failing-tests',
      title: `Fix failing test: ${t.name}`,
      body: t.file ? `Location: ${t.file}` : '' }));
  } catch { return []; }
}

const REGISTRY = { queue: fromQueue, todos: fromTodos, 'failing-tests': fromFailingTests };

export async function getTasks() {
  const which = (process.env.TASK_SOURCE ?? 'queue')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const all = [];
  for (const key of which) if (REGISTRY[key]) all.push(...REGISTRY[key]());
  const seen = new Set();
  return all.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
}
