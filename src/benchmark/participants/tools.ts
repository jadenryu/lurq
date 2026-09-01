/**
 * The lurq tool surface handed to model participants, bound to a db handle.
 *
 * The three with-lurq participants used to import `handlePlan`/`handleVerify`/
 * `handleCompat` and dispatch on the tool name inline — identical code, written
 * out three times. Binding them once here also gives the Weave mirror a single
 * seam to wrap: with tracing on, each tool call becomes a child span of the
 * participant's trace, so a run answers not just "did with-lurq score higher"
 * but "which lurq call changed the model's mind".
 */
import { handlePlan, type PlanInput, type PlanOutput } from '../../mcp/plan';
import { handleVerify, handleCompat } from '../../mcp/handlers';
import { tracedTool } from '../weave';
import type { Database } from '../../db/client';
import type { CompatOutput, VerifyOutput } from '../../core/types';

export interface CompatArgs {
  packages: string[];
  versions?: Record<string, string | null | undefined>;
  node?: string | null;
}

export interface LurqTools {
  plan(args: Pick<PlanInput, 'needs'>): Promise<PlanOutput | { note: string }>;
  verify(args: { package: string }): Promise<VerifyOutput>;
  compat(args: CompatArgs): Promise<CompatOutput>;
}

export function lurqTools(db: Database): LurqTools {
  return {
    plan: tracedTool('plan', (args: Pick<PlanInput, 'needs'>) =>
      handlePlan(db, { needs: args.needs }),
    ),
    verify: tracedTool('verify', (args: { package: string }) =>
      handleVerify(db, { package: args.package }),
    ),
    compat: tracedTool('compat', (args: CompatArgs) =>
      // Node defaults to 20 here rather than in `handleCompat`, matching what
      // the benchmark suites declare as their runtime.
      handleCompat(db, { packages: args.packages, versions: args.versions, node: args.node ?? '20' }),
    ),
  };
}

/**
 * Dispatch one model-issued tool call. Returns an `{ error }` payload for an
 * unknown name rather than throwing, so the model gets a turn to recover from
 * its own typo instead of killing the trial.
 */
export async function callLurqTool(
  tools: LurqTools,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'plan':
      return tools.plan(args as Pick<PlanInput, 'needs'>);
    case 'verify':
      return tools.verify(args as { package: string });
    case 'compat':
      return tools.compat(args as unknown as CompatArgs);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
