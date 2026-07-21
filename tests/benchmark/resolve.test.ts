import { describe, it, expect } from 'vitest';
import { resolveProposal } from '../../src/benchmark/resolve';
import type { Database } from '../../src/db/client';
import type { Sandbox, SandboxResult, SandboxSetResult, SandboxVerifyOptions } from '../../src/sandbox/types';
import type { NormalizedProposal, NormalizedSelection } from '../../src/benchmark/types';

// Dummy Sandbox
class DummySandbox implements Sandbox {
  name = 'dummy';
  async verify(_pkg: string, _version: string | null, _opts?: SandboxVerifyOptions): Promise<SandboxResult> {
    return {
      driver: 'dummy',
      moduleSystem: 'esm',
      installed: true,
      imported: true,
      ranScripts: false,
      durationMs: 10,
      error: null,
    };
  }
  async verifySet(packages: any[], _opts?: SandboxVerifyOptions): Promise<SandboxSetResult> {
    return {
      driver: 'dummy',
      moduleSystem: 'esm',
      installed: true,
      loaded: packages.map(p => ({ name: p.name, loaded: true })),
      durationMs: 10,
      error: null,
    };
  }
  async getRuntimeInfo() {
    return { nodeVersion: 'v20', npmVersion: '10' };
  }
}

import { vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, cb) => {
    // Mock npm view <package>@<version> version
    if (cmd === 'npm' && args[0] === 'view') {
      cb(null, '1.2.3\\n', '');
    } else {
      cb(new Error('unmocked command'), '', '');
    }
  }),
}));

describe('benchmark resolution pipeline', () => {
  it('resolves versions and preflights compat in dry-run', async () => {
    const sandbox = new DummySandbox();
    
    const sel: NormalizedSelection = {
      needId: 'x',
      package: 'react',
      requestedVersion: null,
      scopeHint: 'unknown',
      category: null,
      lurqHealthScore: null,
      lurqConfidence: null,
      lurqSwappedFrom: null,
      source: 'test',
      isRuntime: true,
    };

    const prop: NormalizedProposal = {
      duplicateNames: [],
      invalidNames: [],
      runtimePackages: [sel],
      developmentPackages: [],
    };

    const res = await resolveProposal({} as Database, sandbox, prop, 'test-template:123', { 
      dryRun: true,
      verifyPackage: async (_db, _input) => ({
        exists: true,
        tracked: true,
        deprecated: false,
        archived: false,
        latestVersion: '1.0.0',
        weeklyDownloads: 1000,
        riskFlags: [],
        risk: 'low' as const,
        typosquatOf: null,
        confidence: null,
        advisoryCount: 0,
      }),
      compatCheck: async (_db, _input) => ({
        packages: ['react'],
        overall: 'compatible' as const,
        conflicts: [],
        unverified: [],
        checked: [{ name: 'react', version: null }],
        evidence: [],
      }),
    });
    
    expect(res.packageValidity.existing).toBe(1); 
    expect(res.resolution).toBeNull(); // no E2B in dry run
    expect(res.resolvedSelections[0]?.resolvedVersion).toBeNull(); // skipped in dry run
  });
});
