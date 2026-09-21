/**
 * `lurq fix` reaches every domain, not just packages.
 *
 * The divergence this closes: the dispatch table lived inside the MCP handler,
 * so the command the autopilot runs in CI reached past it to `renamePlan` and
 * `manifestFindings` and could only ever see dependencies. A project whose
 * every dependency was current got "nothing to fix" printed over a retired
 * model id sitting in its source — the one case where nothing else in the
 * toolchain was ever going to say anything.
 *
 * Driven through `--plan` with an empty upgrade list, which is the real shape
 * of a current repository and the one path into `runFix` that touches no
 * network.
 */
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFix } from '../src/cli/fix';
import { SOURCE_DOMAINS, AVAILABLE } from '../src/fix/domains';

let dir: string;
let out: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lurq-fix-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', dependencies: {} }));
  // An empty upgrade list is what a fully current repository produces.
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({ upgrades: [] }));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const run = (over = {}) => runFix(dir, { plan: join(dir, 'plan.json'), ...over });

describe('runFix over the source domains', () => {
  it('finds a retired model id on a repo with nothing to upgrade', async () => {
    writeFileSync(join(dir, 'src/ask.ts'), "export const M = 'claude-3-5-sonnet-20241022';\n");
    await run();

    const text = out.join('\n');
    expect(text).not.toContain('Nothing to fix');
    expect(text).toContain('claude-sonnet-5');
    // A retired id is provable, so it arrives as a diff rather than as advice.
    expect(text).toContain('Would write 1 file(s)');
  });

  it('writes the swap only when asked, and writes it correctly', async () => {
    const file = join(dir, 'src/ask.ts');
    writeFileSync(file, "const m = 'claude-3-opus-20240229';\n");
    await run({ apply: true });
    expect(readFileSync(file, 'utf8')).toBe("const m = 'claude-opus-5';\n");
  });

  it('hands an env finding back as a brief, never as an edit', async () => {
    // Same pipeline, different half of it: nothing can prove what belongs in
    // STRIPE_KEY, so this must reach `remaining` and leave the file alone.
    const file = join(dir, 'src/pay.ts');
    writeFileSync(file, 'export const k = process.env.STRIPE_KEY;\n');
    await run({ apply: true });

    expect(out.join('\n')).toContain('STRIPE_KEY');
    expect(readFileSync(file, 'utf8')).toBe('export const k = process.env.STRIPE_KEY;\n');
  });

  it('still says nothing is wrong when nothing is, and names what it checked', async () => {
    writeFileSync(join(dir, 'src/ask.ts'), "const m = 'claude-opus-5';\n");
    await run();
    const text = out.join('\n');
    expect(text).toContain('Nothing to fix');
    // "Nothing found" must not read like "never looked": the message names the
    // domains that ran, so a silent detector cannot pass for a clean project.
    for (const domain of SOURCE_DOMAINS) expect(text).toContain(domain);
  });

  it('reports a domain that could not run instead of counting it clean', async () => {
    writeFileSync(join(dir, 'src/ask.ts'), "const m = 'claude-opus-5';\n");
    await run({ json: true });
    expect(JSON.parse(out.join('\n'))).toMatchObject({ unchecked: [] });
  });
});

describe('the domain split', () => {
  it('is every domain except the one that needs a version pair', () => {
    // `package` cannot say anything without an upgrade to compare, which is
    // why it is the only one `runFix` does not ask for up front.
    expect(SOURCE_DOMAINS).toEqual(AVAILABLE.filter((d) => d !== 'package'));
    expect(SOURCE_DOMAINS).not.toContain('package');
  });
});
