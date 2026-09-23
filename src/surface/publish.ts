/**
 * Accepting a surface an author extracted on their own machine.
 *
 * Every other way a surface enters the index starts from an artifact lurq
 * fetched itself, so the evidence is self-evident. This one does not: the
 * author ran the extractor and sent the result. That is the whole point — a
 * private package has no tarball lurq can reach, and no model has ever seen it
 * — but it means the payload is untrusted input and is treated as such here.
 *
 * Two consequences the caps below encode:
 *   - The surface is filed under the SENDER'S tenant and nowhere else. A
 *     published surface can never contradict the public graph, so there is no
 *     promotion path and no corroboration to weigh (unlike `mcp_public_reports`,
 *     where client-submitted scans do compete with the public record).
 *   - The oracle id says where it came from. `surface.author` is not
 *     `surface.tier_a`: lurq ran neither the extraction nor the machine, and a
 *     verdict has to carry how it was established, not merely what it says.
 */
import { z } from 'zod';
import { and, countDistinct, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../db/client';
import { entities } from '../db/schema';
import { storeSurface } from '../db/surface';
import type { ExtractedSurface } from './types';

/**
 * A surface bigger than this is not a package an agent is going to reason
 * about symbol-by-symbol anyway, and the cap is what stops one payload from
 * being the whole request budget.
 */
export const MAX_SYMBOLS_PER_SURFACE = 5_000;

/**
 * Distinct private package names per account. Generous enough that no real
 * monorepo hits it, low enough that a loop publishing generated names stops.
 */
export const MAX_PRIVATE_PACKAGES_PER_OWNER = 500;

export const PUBLISH_BODY_LIMIT = '4mb';

/** The extractor that ran on the author's machine, not one of ours. */
export const AUTHOR_ORACLE = 'surface.author';

const Symbol_ = z.object({
  path: z.string().min(1).max(512),
  kind: z.enum(['function', 'class', 'object', 'primitive', 'type_only']),
  arity: z.number().int().min(-1).max(1024).nullable(),
  maxArity: z.number().int().min(-1).max(1024).nullable().optional(),
  origin: z.string().max(256),
  deprecated: z.boolean(),
  tier: z.enum([
    'shipped_js_ast',
    'runtime_import',
    'bundled_dts',
    'types_package',
    'jsdoc_generated',
  ]),
  signature: z.string().max(4_000).optional(),
  sourceRef: z
    .object({
      // Already a digest by the time it arrives — see hashSourcePaths in the
      // CLI. Capped anyway: this route cannot assume its caller is our CLI.
      file: z.string().max(256),
      line: z.number().int().min(0).max(10_000_000),
      offset: z.number().int().min(0).optional(),
    })
    .optional(),
});

/**
 * `version` is required, unlike the extractor's IR. A surface is keyed by
 * `kind:namespace:name:version`, so an unversioned one would overwrite itself
 * on every publish and no diff could ever be taken against it.
 */
export const PublishSchema = z.object({
  package: z
    .string()
    .min(1)
    .max(214)
    .regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i, 'not an npm package name'),
  version: z.string().min(1).max(64),
  tier: z.enum([
    'shipped_js_ast',
    'runtime_import',
    'bundled_dts',
    'types_package',
    'jsdoc_generated',
  ]),
  entry: z.string().max(512).nullable(),
  symbols: z.array(Symbol_).max(MAX_SYMBOLS_PER_SURFACE),
  filesWalked: z.number().int().min(0).max(1_000_000),
  externalReExports: z.array(z.string().max(512)).max(1_000),
  /** The extractor's version, so a re-extraction can invalidate what it wrote. */
  extractorVersion: z.string().min(1).max(32),
});

export type PublishInput = z.infer<typeof PublishSchema>;

export interface PublishResult {
  package: string;
  version: string;
  symbolsWritten: number;
  verdict: string;
}

/** Distinct private package names already filed under this tenant. */
export async function countPrivatePackages(db: Database, tenantId: number): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(entities.name) })
    .from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.kind, 'package_surface')));
  return row?.n ?? 0;
}

/** Whether this tenant has filed any version of this package before. */
export async function publishedAlready(
  db: Database,
  tenantId: number,
  pkg: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.tenantId, tenantId),
        eq(entities.kind, 'package_surface'),
        eq(entities.name, pkg),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The version this tenant published immediately before `version`, or null.
 *
 * Ordered by when lurq first saw each row, not by semver — a backport
 * publishing 3.9.2 after 4.0.0 means the predecessor by number is not the
 * predecessor in time, and the question a diff answers is "what changed when
 * this was released". Same reasoning as `previousVersion` in db/surface.ts.
 */
export async function previousPublishedVersion(
  db: Database,
  pkg: string,
  version: string,
  tenantId: number,
): Promise<string | null> {
  const [current] = await db
    .select({ firstSeen: entities.firstSeen })
    .from(entities)
    .where(
      and(
        eq(entities.tenantId, tenantId),
        eq(entities.kind, 'package_surface'),
        eq(entities.name, pkg),
        eq(entities.version, version),
      ),
    )
    .limit(1);
  if (!current) return null;

  const [prev] = await db
    .select({ version: entities.version })
    .from(entities)
    .where(
      and(
        eq(entities.tenantId, tenantId),
        eq(entities.kind, 'package_surface'),
        eq(entities.name, pkg),
        lt(entities.firstSeen, current.firstSeen),
      ),
    )
    .orderBy(desc(entities.firstSeen))
    .limit(1);
  return prev?.version ?? null;
}

/**
 * File the surface under `tenantId`.
 *
 * An empty symbol list is passed through rather than rejected: `storeSurface`
 * records it as `undeclared` with the reason, which is a measurement gap and
 * NOT the claim that the package exports nothing. Rejecting it here would
 * throw away the one honest answer for a package whose build has not run.
 */
export async function publishSurface(
  db: Database,
  input: PublishInput,
  tenantId: number,
): Promise<PublishResult> {
  const surface: ExtractedSurface = {
    package: input.package,
    version: input.version,
    tier: input.tier,
    entry: input.entry,
    symbols: input.symbols as ExtractedSurface['symbols'],
    filesWalked: input.filesWalked,
    externalReExports: input.externalReExports,
    ...(input.symbols.length === 0
      ? { undeclaredReason: 'author published an empty surface; the package may not be built' }
      : {}),
  };

  const stored = await storeSurface(db, surface, {
    extractorVersion: input.extractorVersion,
    tenantId,
    oracleId: AUTHOR_ORACLE,
  });

  return {
    package: input.package,
    version: input.version,
    symbolsWritten: stored.symbolsWritten,
    verdict: stored.verdict,
  };
}
