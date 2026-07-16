import { describe, it, expect, beforeEach } from 'vitest';
import {
  CATEGORIES,
  isCategory,
  isFrontendCategory,
  FRONTEND_CATEGORIES,
} from '../src/core/types';
import { buildProgram } from '../src/cli/index';
import { registerOperatorCommands } from '../src/cli/operator';
import {
  getConfig,
  requireConfig,
  resetConfigCache,
  loadEnv,
  ConfigError,
} from '../src/core/config';

describe('taxonomy', () => {
  it('contains the core v1 categories plus `other`', () => {
    for (const c of ['framework', 'orm', 'styling', 'testing', 'other']) {
      expect(CATEGORIES).toContain(c);
    }
  });

  it('isCategory narrows valid/invalid strings', () => {
    expect(isCategory('orm')).toBe(true);
    expect(isCategory('nonsense')).toBe(false);
  });

  it('frontend categories are a subset of the taxonomy', () => {
    for (const c of FRONTEND_CATEGORIES) {
      expect(CATEGORIES).toContain(c);
    }
    expect(isFrontendCategory('styling')).toBe(true);
    expect(isFrontendCategory('orm')).toBe(false);
    expect(isFrontendCategory(null)).toBe(false);
  });
});

describe('cli program', () => {
  it('public program registers the read-only oracle commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    for (const expected of [
      'serve',
      'recommend',
      'evaluate',
      'compare',
      'verify',
      'usage',
      'compat',
      'install-skill',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('public program excludes operator commands (§4E plane split)', () => {
    const names = buildProgram().commands.map((c) => c.name());
    for (const operatorOnly of ['sync', 'discover', 'worker', 'rescore', 'watch', 'sandbox', 'keys', 'db']) {
      expect(names).not.toContain(operatorOnly);
    }
  });

  it('operator plane adds the dataset-building commands + db subcommands', () => {
    const program = buildProgram();
    registerOperatorCommands(program);
    const names = program.commands.map((c) => c.name());
    for (const expected of ['sync', 'discover', 'worker', 'watch', 'sandbox', 'keys', 'db']) {
      expect(names).toContain(expected);
    }
    const db = program.commands.find((c) => c.name() === 'db');
    const subs = db?.commands.map((c) => c.name()) ?? [];
    expect(subs).toContain('migrate');
    expect(subs).toContain('reset');
  });
});

describe('config', () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it('applies documented defaults', () => {
    const config = getConfig();
    expect(config.EMBEDDING_PROVIDER).toBe('openai');
    expect(config.EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(config.LURQ_SYNC_CONCURRENCY).toBe(5);
    expect(config.LOG_LEVEL).toBeDefined();
  });

  it('requireConfig throws a clear error when a required var is missing', () => {
    loadEnv(); // ensure .env is already loaded so it won't repopulate after deletion
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    expect(() => requireConfig(['DATABASE_URL'])).toThrow(ConfigError);
    if (original !== undefined) process.env.DATABASE_URL = original;
  });
});
