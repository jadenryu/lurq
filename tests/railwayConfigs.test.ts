/**
 * Contract tests for Railway service configs that touch the sync/operator plane.
 * Dashboard services (lurq-sync / lurq-api / lurq-discover) should map to these
 * files — catching a second "sync" start command in-repo prevents the dual-cron
 * collision we saw on production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function loadRailway(name: string): {
  deploy: {
    startCommand?: string;
    cronSchedule?: string;
    healthcheckPath?: string;
    restartPolicyType?: string;
  };
} {
  return JSON.parse(readFileSync(join(root, name), 'utf8')) as ReturnType<typeof loadRailway>;
}

describe('Railway service configs (sync / api / discover)', () => {
  const sync = loadRailway('railway.json');
  const api = loadRailway('railway.serve.json');
  const discover = loadRailway('railway.discover.json');

  it('lurq-sync (railway.json): daily operator sync + repo scan cron', () => {
    // `;` not `&&`: a failed package sync must not skip the repo scan. The two
    // read different sources and neither depends on the other succeeding.
    expect(sync.deploy.startCommand).toBe(
      'node dist-operator/bin/operator.js sync; node dist-operator/bin/operator.js repos-scan',
    );
    expect(sync.deploy.cronSchedule).toBe('0 6 * * *'); // 06:00 UTC = 2am EDT
    expect(sync.deploy.restartPolicyType).toBe('NEVER');
    expect(sync.deploy.healthcheckPath).toBeUndefined();
  });

  it('lurq-api (railway.serve.json): migrate + serve-http, not a sync cron', () => {
    expect(api.deploy.startCommand).toContain('serve-http');
    expect(api.deploy.startCommand).toContain('db migrate');
    expect(api.deploy.startCommand).not.toMatch(/\bsync\b/);
    expect(api.deploy.healthcheckPath).toBe('/healthz');
    expect(api.deploy.cronSchedule).toBeUndefined();
    expect(api.deploy.restartPolicyType).toBe('ON_FAILURE');
  });

  it('lurq-discover (railway.discover.json): periodic worker, not sync', () => {
    expect(discover.deploy.startCommand).toContain('worker --once');
    expect(discover.deploy.startCommand).not.toMatch(/\bsync\b/);
    expect(discover.deploy.cronSchedule).toBe('0 * * * *');
    expect(discover.deploy.restartPolicyType).toBe('NEVER');
    // --cap and --extract move together with the schedule. Measured against the
    // production index: 11.9s fixed per cycle, 5.6s per package, 1.75s per
    // extraction — so hourly at 400/200 is ~43min of a 60min window, the same
    // headroom the 15-minute schedule had at 100/50, and the same daily
    // throughput. Scaling the cron without scaling these would quietly cut
    // ingestion or surface extraction by 75%.
    expect(discover.deploy.startCommand).toContain('--cap 400');
    expect(discover.deploy.startCommand).toContain('--extract 200');
  });

  it('exactly one repo Railway config runs operator sync (no duplicate cron in git)', () => {
    const configs = [
      ['railway.json', sync],
      ['railway.serve.json', api],
      ['railway.discover.json', discover],
    ] as const;
    const syncConfigs = configs.filter(([, c]) =>
      /\boperator\.js sync\b/.test(c.deploy.startCommand ?? ''),
    );
    expect(syncConfigs.map(([name]) => name)).toEqual(['railway.json']);
  });
});
