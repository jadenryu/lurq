import { describe, expect, it } from 'vitest';
import type { createDb } from '../src/db/client';
import { callDashboardTool, DASHBOARD_TOOLS, listDashboardTools } from '../src/mcp/dashboardTools';

// Listing touches no database: tools are registered up front and only their
// handlers read. A stub proves the list comes from the real server.ts.
const db = {} as ReturnType<typeof createDb>['db'];

describe('dashboard tools', () => {
  it('lists exactly the allowlist, with the schemas server.ts declares', async () => {
    const tools = await listDashboardTools(db);
    expect(tools.map((t) => t.name).sort()).toEqual([...DASHBOARD_TOOLS].sort());
    const compare = tools.find((t) => t.name === 'compare');
    expect(compare?.inputSchema).toMatchObject({ type: 'object', required: ['packages'] });
  });

  it('refuses a tool outside the allowlist, including writes', async () => {
    await expect(callDashboardTool(db, 'owner', 'report_outcome', {})).rejects.toThrow(
      'not available to Ask',
    );
  });
});
