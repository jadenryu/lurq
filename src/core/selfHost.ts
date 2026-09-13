/**
 * The self-host server stack is not installed with the published package.
 *
 * `npx lurqrun` ships without express, postgres, drizzle-orm, stripe and the
 * rest (see scripts/publish-manifest.mjs): they serve `lurq serve`, `serve-http`
 * and a local DATABASE_URL index, which almost nobody who types `npx lurqrun`
 * runs. When someone does, Node's own error is "Cannot find package 'postgres'
 * imported from …/dist/chunk-X.js", which reads like a broken release. This
 * turns it into the one command that fixes it.
 */
import pkg from '../../package.json' with { type: 'json' };
import { PACKAGE_NAME } from './constants';

export const SELF_HOST_DEPENDENCIES: readonly string[] = pkg.lurq.selfHostDependencies;

/** A helpful message for a missing self-host dependency, or null for any other error. */
export function selfHostHint(err: unknown): string | null {
  if ((err as { code?: unknown })?.code !== 'ERR_MODULE_NOT_FOUND') return null;
  const missing = /Cannot find package '([^']+)'/.exec((err as Error).message ?? '')?.[1];
  if (!missing || !SELF_HOST_DEPENDENCIES.includes(missing)) return null;
  // Every one, not only the first that failed: installing them one error at a
  // time is seven round trips.
  const deps = SELF_HOST_DEPENDENCIES.map((name) => `${name}@${pkg.dependencies[name as keyof typeof pkg.dependencies]}`);
  return (
    `This command runs lurq's server or a local index, which needs packages the CLI does not install ` +
    `("${missing}" is missing). Hosted users never need them: run \`lurq setup\` instead.\n` +
    `To self-host, install them next to lurq:\n` +
    `  npm install -g ${PACKAGE_NAME} ${deps.join(' ')}`
  );
}
