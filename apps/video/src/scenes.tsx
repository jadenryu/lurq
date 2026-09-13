import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AGENT_LOGOS, color, HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, MONO, SANS } from "./brand";
import { Background, Caption, enter, Stack, Terminal, typed, useUnit, type Line } from "./components";

// A name that is not on npm (checked against the registry). The verdict lines are
// lurq's real `verify` output for it.
const FAKE_PACKAGE = "next-auth-session-helpers";
const INSTALL = `$ npm install ${FAKE_PACKAGE}`;

const agentLines = (start: number): { at: number; line: Line }[] => [
  { at: start, line: { text: "> add session handling to the auth flow", tone: "ink2" } },
  { at: start + 14, line: { text: "" } },
  { at: start + 22, line: { text: "● I'll add a helper package for this.", tone: "ink" } },
];

export function Hook() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Background />
      <Stack>
        <Terminal
          title="coding agent"
          lines={agentLines(0)}
          typedLine={frame >= 40 ? <div style={{ color: color.ink }}>{typed(INSTALL, frame, 40, fps, 34)}</div> : null}
        />
        <Caption at={78}>Your agent just made this up.</Caption>
      </Stack>
    </AbsoluteFill>
  );
}

export function Catch() {
  return (
    <AbsoluteFill>
      <Background />
      <Stack>
        <Terminal
          title="coding agent · lurq"
          lines={[
            ...agentLines(-60),
            { at: 0, line: { text: `  lurq · verify ${FAKE_PACKAGE}`, tone: "ink3" } },
            { at: 16, line: { text: "" } },
            { at: 22, line: { text: `${FAKE_PACKAGE}  ✗ NOT A REAL PACKAGE`, tone: "bad", bold: true } },
            { at: 34, line: { text: "  • no such package on npm. This name does not exist,", tone: "ink2" } },
            { at: 40, line: { text: "    so there is nothing to assess.", tone: "ink2" } },
          ]}
        />
        <Caption at={60}>lurq checks every package before your agent installs it.</Caption>
      </Stack>
    </AbsoluteFill>
  );
}

// lurq's real `check-upgrade` report for a file that imports `parse` from cookie.
export function Upgrade() {
  return (
    <AbsoluteFill>
      <Background />
      <Stack>
        <Terminal
          title="terminal"
          lines={[
            { at: 0, line: { text: "$ lurq check-upgrade . --upgrade cookie@1.1.1..2.0.1", tone: "ink" } },
            { at: 24, line: { text: "" } },
            { at: 32, line: { text: "BLOCKING  cookie  1.1.1 → 2.0.1", tone: "bad", bold: true } },
            { at: 44, line: { text: "  Removes 1 symbol(s) your code references:", tone: "ink2" } },
            { at: 56, line: { text: "    · cookie.parse → parseCookie    src/session.js:1, src/session.js:4", tone: "ink" } },
            { at: 72, line: { text: "  → is a proven rename: both names were the same function at 1.1.1.", tone: "good" } },
          ]}
        />
        <Caption at={110}>Passes your tests. Breaks in production.</Caption>
      </Stack>
    </AbsoluteFill>
  );
}

export function Everywhere() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = useUnit();
  const square = width / height < 1.2;
  const size = (square ? 118 : 96) * u;
  return (
    <AbsoluteFill>
      <Background />
      <Stack gap={80}>
        <div style={{ ...enter(frame, 0), fontFamily: SANS, fontWeight: 500, fontSize: (square ? 52 : 60) * u, letterSpacing: "-0.03em", color: color.ink, textAlign: "center", textWrap: "balance", maxWidth: width - 120 * u }}>
          {IDE_HEADING}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${square ? 3 : AGENT_LOGOS.length}, ${size * 1.9}px)`, rowGap: 48 * u, justifyContent: "center" }}>
          {AGENT_LOGOS.map((logo, i) => (
            <div key={logo.file} style={{ ...enter(frame, 14 + i * 5), display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
              {/* One tone for every mark, the way the site shows them. */}
              <Img src={staticFile(`logos/${logo.file}.svg`)} style={{ width: size * 0.62, height: size * 0.62, objectFit: "contain", filter: "brightness(0) invert(0.82)" }} />
              <div style={{ fontFamily: SANS, fontSize: 24 * u, color: color.ink2 }}>{logo.name}</div>
            </div>
          ))}
        </div>
      </Stack>
    </AbsoluteFill>
  );
}

export function Close() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const { width, height } = useVideoConfig();
  const headlineSize = (width / height < 1.2 ? 60 : 96) * u;
  return (
    <AbsoluteFill>
      <Background />
      <Stack gap={64}>
        <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: headlineSize, lineHeight: 1.08, letterSpacing: "-0.035em", color: color.ink, textAlign: "center", padding: `0 ${60 * u}px` }}>
          <div style={{ ...enter(frame, 0, 20), whiteSpace: "nowrap" }}>{HEADLINE_LINE_1}</div>
          <div style={{ ...enter(frame, 10, 20), whiteSpace: "nowrap" }}>{HEADLINE_LINE_2}</div>
        </div>
        <div style={{ ...enter(frame, 34), display: "flex", alignItems: "center", gap: 16 * u, background: color.ink, color: color.ground, borderRadius: 999, padding: `${22 * u}px ${44 * u}px`, fontFamily: MONO, fontWeight: 700, fontSize: 40 * u }}>
          <span style={{ color: color.ink3 }}>$</span>
          {INSTALL_COMMAND}
        </div>
        <div style={{ ...enter(frame, 50), fontFamily: SANS, fontSize: 34 * u, color: color.ink3 }}>lurq.run</div>
      </Stack>
    </AbsoluteFill>
  );
}
