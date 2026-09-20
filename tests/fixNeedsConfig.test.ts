/**
 * The one finding no agent should act on alone.
 *
 * A server stuck on `needs_config` is waiting for a value only the user has, so
 * the test that matters is not the shape of the finding but that its
 * instruction sends the agent to the user and nowhere else.
 */
import { describe, expect, it } from 'vitest';
import { scanFindings, type ScanLike } from '../src/fix/mcpConfig';

const stuck = (over: Partial<ScanLike['servers'][number]> = {}): ScanLike['servers'][number] => ({
  alias: 'github',
  analysis: null,
  status: 'needs_config',
  error: 'no value for GITHUB_TOKEN',
  hint: 'export GITHUB_TOKEN before scanning',
  ...over,
});

const report = (over: Partial<ScanLike> = {}): ScanLike => ({
  servers: [stuck()],
  findings: [],
  configSources: { github: { file: '.cursor/mcp.json', section: 'mcpServers' } },
  ...over,
});

describe('a server that cannot start', () => {
  it('is blocking, because nothing it exposes matters if it never runs', () => {
    const [f] = scanFindings(report());
    expect(f!.severity).toBe('blocking');
    expect(f!.code).toBe('mcp-needs-config:github');
    expect(f!.detail).toBe('github cannot start: no value for GITHUB_TOKEN');
  });

  it('sends the agent to the user, and rules out every other source', () => {
    const task = scanFindings(report())[0]!.fix!.task!;
    expect(task.instruction).toMatch(/Ask the user/);
    // The failure this wards off is an agent inventing a plausible credential.
    expect(task.instruction).toMatch(
      /never from a log, an example file, a previous scan, or a guess/,
    );
  });

  it('verifies by probing again, since no file edit can prove it', () => {
    expect(scanFindings(report())[0]!.fix!.verify).toEqual(['probe']);
  });

  it('points at the config file that declared it', () => {
    const [f] = scanFindings(report());
    expect(f!.file).toBe('.cursor/mcp.json');
    expect(f!.section).toBe('mcpServers.github');
    expect(f!.fix!.task!.files).toEqual(['.cursor/mcp.json']);
  });

  it('still reports when the config file is unknown, with no files to touch', () => {
    const [f] = scanFindings(report({ configSources: undefined }));
    expect(f!.file).toBeUndefined();
    expect(f!.fix!.task!.files).toEqual([]);
  });

  it('survives a scan that recorded no error text', () => {
    const [f] = scanFindings(report({ servers: [stuck({ error: null, hint: null })] }));
    expect(f!.detail).toBe('github cannot start: it needs configuration that is not set');
    expect(f!.evidence).toBeUndefined();
  });
});

describe('statuses this does not claim', () => {
  it('says nothing about a server that scanned fine', () => {
    expect(scanFindings(report({ servers: [stuck({ status: 'ok', error: null })] }))).toEqual([]);
  });

  it('leaves auth_required alone, because a sign-in is not a pasted value', () => {
    expect(scanFindings(report({ servers: [stuck({ status: 'auth_required' })] }))).toEqual([]);
  });

  it('leaves untrusted and disabled alone: those are decisions, not problems', () => {
    expect(scanFindings(report({ servers: [stuck({ status: 'untrusted' })] }))).toEqual([]);
    expect(scanFindings(report({ servers: [stuck({ status: 'disabled' })] }))).toEqual([]);
  });
});

describe('ordering', () => {
  it('puts a server that never started ahead of findings from ones that did', () => {
    const findings = scanFindings(
      report({
        servers: [
          {
            alias: 'linear',
            analysis: {
              findings: [
                {
                  kind: 'prompt-injection' as never,
                  severity: 'critical',
                  tool: 't',
                  where: 'description',
                  detail: 'steers the model',
                  evidence: null,
                },
              ],
            },
          },
          stuck(),
        ],
      }),
    );
    expect(findings.map((f) => f.code)).toEqual([
      'mcp-needs-config:github',
      'mcp-prompt-injection:linear:t',
    ]);
  });
});
