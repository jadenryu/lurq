// Per-surface product visuals: lifted charcoal frames with soft syntax colors
// (prompt / ok / accent / bad) so they read like a real CLI without fighting
// the monochrome page chrome.

const c = {
  text: "#e4e4e4",
  dim: "#8a8a8a",
  prompt: "#9db4ff",
  ok: "#7dcea0",
  bad: "#e08b7a",
  accent: "#c4b5fd",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-full min-h-[18rem] flex-col justify-between overflow-hidden bg-[#14161a] p-5 font-mono text-[12px] leading-relaxed md:min-h-[22rem] md:p-7 md:text-[13px]">
      <div>{children}</div>
    </div>
  );
}

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2">
      <span style={{ color: c.prompt }}>$</span>
      <span style={{ color: c.text }}>{children}</span>
    </p>
  );
}

function Cursor() {
  return (
    <span
      className="ml-1 inline-block h-3 w-[6px] align-middle motion-safe:animate-pulse"
      style={{ backgroundColor: c.text }}
    />
  );
}

function Bar({ value }: { value: number }) {
  return (
    <span
      className="inline-block h-1 rounded-full"
      style={{
        width: `${value}%`,
        maxWidth: "7rem",
        backgroundColor: c.accent,
        opacity: 0.7,
      }}
    />
  );
}

function Mcp() {
  return (
    <Shell>
      <Prompt>claude mcp add lurq</Prompt>
      <p className="mt-1" style={{ color: c.ok }}>
        ✓ connected · https://api.lurq.run/mcp
      </p>
      <p className="mt-1" style={{ color: c.dim }}>
        tools: recommend evaluate compare verify diagram
      </p>
      <p className="mt-4 flex gap-2">
        <span style={{ color: c.ok }}>⏺</span>
        <span style={{ color: c.text }}>lurq</span>
        <span style={{ color: c.dim }}>· recommend(&quot;orm for postgres&quot;)</span>
      </p>
      <p className="pl-5" style={{ color: c.dim }}>
        ⎿ <span style={{ color: c.accent }}>drizzle-orm</span> · 91 · proven
        <Cursor />
      </p>
    </Shell>
  );
}

function Cli() {
  return (
    <Shell>
      <Prompt>lurq recommend &quot;form library for react&quot;</Prompt>
      <div className="mt-3 space-y-0.5" style={{ color: c.text }}>
        <p>
          1 react-hook-form <span style={{ color: c.dim }}>94 · proven</span>
        </p>
        <p>
          2 @tanstack/form <span style={{ color: c.dim }}>81 · emerging</span>
        </p>
        <p>
          3 formik <span style={{ color: c.dim }}>76 · proven</span>
        </p>
      </div>
      <p className="mt-3" style={{ color: c.accent }}>
        → pick: react-hook-form
        <Cursor />
      </p>
    </Shell>
  );
}

function Api() {
  return (
    <Shell>
      <p style={{ color: c.text }}>
        <span style={{ color: c.accent }}>POST</span> /recommend
      </p>
      <p style={{ color: c.dim }}>{'{ "need": "date parsing", "lang": "ts" }'}</p>
      <p className="mt-3" style={{ color: c.ok }}>
        200 OK · 38ms
      </p>
      <p style={{ color: c.dim }}>{'{ "top": "date-fns", "score": 94,'}</p>
      <p style={{ color: c.dim }}>
        {'  "dataAsOf": "2h ago" }'}
        <Cursor />
      </p>
    </Shell>
  );
}

function Skill() {
  return (
    <Shell>
      <Prompt>npx lurqrun install-skill --agent claude-code</Prompt>
      <div className="mt-2 space-y-1" style={{ color: c.ok }}>
        <p>✓ detected Claude Code</p>
        <p>✓ wrote keyed MCP entry</p>
        <p>✓ no db credentials on this machine</p>
      </div>
      <p className="mt-3" style={{ color: c.dim }}>
        → restart your agent to finish
        <Cursor />
      </p>
    </Shell>
  );
}

function Index() {
  return (
    <Shell>
      <div style={{ color: c.dim }}>
        <p>npm ────┐</p>
        <p>
          github ─┼──▶ <span style={{ color: c.accent }}>lurq index</span> ·
          synced daily
        </p>
        <p>deps.dev┘</p>
      </div>
      <p className="mt-4" style={{ color: c.text }}>
        128,402 packages
      </p>
      <p style={{ color: c.ok }}>
        rescored 2h ago
        <Cursor />
      </p>
    </Shell>
  );
}

function Search() {
  return (
    <Shell>
      <p style={{ color: c.text }}>
        <span style={{ color: c.prompt }}>?</span> lightweight state management
      </p>
      <div className="mt-4 space-y-2.5" style={{ color: c.text }}>
        <p className="flex items-center gap-3">
          zustand <span style={{ color: c.dim }}>96</span> <Bar value={96} />
        </p>
        <p className="flex items-center gap-3">
          jotai <span style={{ color: c.dim }}>88</span> <Bar value={82} />
        </p>
        <p className="flex items-center gap-3">
          redux-toolkit <span style={{ color: c.dim }}>79</span>{" "}
          <Bar value={62} />
        </p>
      </div>
    </Shell>
  );
}

function Cache() {
  return (
    <Shell>
      <p style={{ color: c.dim }}>GET recommend:orm:postgres</p>
      <p className="mt-3 flex gap-2">
        <span style={{ color: c.ok }}>●</span>
        <span style={{ color: c.text }}>HIT · 2ms</span>
        <span style={{ color: c.dim }}>(redis)</span>
      </p>
      <p className="flex gap-2">
        <span style={{ color: c.bad }}>●</span>
        <span style={{ color: c.text }}>MISS · 214ms</span>
        <span style={{ color: c.dim }}>→ index</span>
      </p>
      <p className="mt-3" style={{ color: c.dim }}>
        ttl 3600s
        <Cursor />
      </p>
    </Shell>
  );
}

const VISUALS: Record<string, () => React.ReactNode> = {
  mcp: Mcp,
  cli: Cli,
  api: Api,
  skill: Skill,
  index: Index,
  search: Search,
  cache: Cache,
};

export function SurfaceVisual({ id }: { id: string }) {
  const V = VISUALS[id];
  return V ? <V /> : null;
}
