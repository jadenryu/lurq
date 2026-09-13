import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AGENT_LOGOS, color, HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, MONO, SANS, WORDMARK } from "./brand";
import { Background, Bar, Chip, Clip, ClipPanel, Counter, DotMatrix, Frame, Icon, Kicker, Mark, progress, Source, useSquare, useUnit, Words } from "./components";
import { arrowRight, gitCompareArrows, packageX, shieldCheck, triangleAlert } from "./icons";

/*
 * Every number is quoted from its source, which is named on screen:
 * - Stack Overflow Developer Survey 2025 (AI section): 84% use or plan to use AI tools; 46% distrust their accuracy.
 * - Spracklen et al., "We Have a Package for You!", USENIX Security 2025: 576,000 samples from 16 models,
 *   205,474 unique hallucinated package names, at least 21.7% (open-source) and 5.2% (commercial) hallucinated.
 * - Sonatype, 2026 State of the Software Supply Chain: 454,600+ new malicious packages in 2025, over 99% on npm.
 */

// A name that is not on npm (checked against the registry). The verdict lines are
// lurq's real `verify` output for it.
const FAKE_PACKAGE = "next-auth-session-helpers";

export function Open() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Clip name="city" dim={0.45} />
      <Frame justify="flex-end">
        <Kicker index="01" label="The shift" at={4} />
        <Words text="Software is now written by machines." at={10} size={square ? 88 : 116} style={{ maxWidth: 1250 * u, marginTop: 30 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Adoption() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Background />
      <Frame>
        <Kicker index="02" label="Adoption" />
        <div style={{ display: "flex", flexDirection: square ? "column" : "row", alignItems: square ? "flex-start" : "flex-end", gap: (square ? 28 : 64) * u, marginTop: 44 * u }}>
          <Counter to={84} suffix="%" at={4} size={square ? 250 : 320} />
          <div style={{ maxWidth: 780 * u, paddingBottom: square ? 0 : 34 * u }}>
            <Words text="of developers use or plan to use AI tools to write code." at={12} size={square ? 50 : 58} weight={500} />
            <Words text="46% don't trust its accuracy." at={40} size={square ? 32 : 36} weight={500} tone="warn" style={{ marginTop: 22 * u }} />
          </div>
        </div>
        <Bar value={84} at={4} style={{ marginTop: 56 * u }} />
      </Frame>
      <Source at={26}>Stack Overflow Developer Survey 2025</Source>
    </AbsoluteFill>
  );
}

export function Invent() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground, flexDirection: square ? "column" : "row" }}>
      <ClipPanel name="code" from={square ? "top" : "left"} />
      <div style={{ flex: 1, position: "relative" }}>
        <Frame style={{ gap: 34 * u }}>
          <Icon node={packageX} at={6} size={square ? 84 : 110} tone="bad" />
          <Kicker index="03" label="The flaw" at={10} />
          <Words text="But AI invents packages that don't exist." at={16} size={square ? 64 : 84} />
        </Frame>
      </div>
    </AbsoluteFill>
  );
}

function MiniStat({ value, label, at }: { value: string; label: string; at: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, at);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px)`, borderLeft: `2px solid ${color.bad}`, paddingLeft: 22 * u }}>
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 64 * u, letterSpacing: "-0.04em", color: color.ink }}>{value}</div>
      <div style={{ fontFamily: MONO, fontSize: 20 * u, letterSpacing: "0.08em", textTransform: "uppercase", color: color.ink3, marginTop: 6 * u }}>{label}</div>
    </div>
  );
}

export function Hallucination() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Clip name="fiber" dim={0.8} />
      <Frame>
        <Kicker index="04" label="In one study" />
        <div style={{ marginTop: 36 * u }}>
          <Counter to={205474} at={4} size={square ? 170 : 230} />
        </div>
        <Words text="made-up package names from 16 code models." at={14} size={square ? 48 : 58} weight={500} style={{ marginTop: 24 * u, maxWidth: 1100 * u }} />
        <div style={{ display: "flex", gap: 64 * u, marginTop: 52 * u }}>
          <MiniStat value="21.7%" label="Open-source models" at={40} />
          <MiniStat value="5.2%" label="Commercial models" at={46} />
        </div>
      </Frame>
      <Source at={30}>Spracklen et al., USENIX Security 2025</Source>
    </AbsoluteFill>
  );
}

export function Malware() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Background />
      <Frame style={{ flexDirection: square ? "column" : "row", alignItems: square ? "flex-start" : "center", justifyContent: square ? "center" : "space-between", gap: 48 * u }}>
        <div>
          <Kicker index="05" label="The attack" />
          <div style={{ marginTop: 36 * u }}>
            <Counter to={454600} at={4} size={square ? 150 : 190} />
          </div>
          <Words text="new malicious open-source packages in 2025." at={14} size={square ? 44 : 54} weight={500} style={{ marginTop: 22 * u, maxWidth: 820 * u }} />
          <Words text="Over 99% of them on npm." at={40} size={square ? 34 : 40} weight={500} tone="bad" style={{ marginTop: 20 * u }} />
        </div>
        <DotMatrix at={6} cols={square ? 30 : 22} rows={square ? 8 : 18} />
      </Frame>
      <Source at={30}>Sonatype, State of the Software Supply Chain 2026</Source>
    </AbsoluteFill>
  );
}

export function Name() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const word = progress(frame, 10, 18);
  return (
    <AbsoluteFill>
      <Clip name="hallway" dim={0.72} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 * u, padding: `0 ${80 * u}px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34 * u }}>
          <Mark size={square ? 120 : 150} />
          <div style={{ opacity: word, letterSpacing: `${-0.01 + (1 - word) * 0.2}em`, fontFamily: MONO, fontWeight: 700, fontSize: (square ? 130 : 160) * u, color: color.ink }}>{WORDMARK}</div>
        </div>
        <Words text="checks every package before your agent installs it." at={22} size={square ? 50 : 60} weight={500} tone="ink2" style={{ textAlign: "center", maxWidth: 1200 * u }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function Verify() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const square = useSquare();
  const command = `lurq verify ${FAKE_PACKAGE}`;
  const typed = command.slice(0, Math.max(0, Math.floor(((frame - 14) / fps) * 40)));
  const caret = frame < 44 && Math.floor(frame / 8) % 2 === 0;
  const readout = progress(frame, 48);
  return (
    <AbsoluteFill>
      <Background />
      <Frame>
        <Kicker index="06" label="Verify" />
        <Words text="Caught before it's installed." at={2} size={square ? 76 : 100} style={{ marginTop: 30 * u }} />
        <div style={{ marginTop: 56 * u, paddingTop: 40 * u, borderTop: `1px solid ${color.edge}`, fontFamily: MONO, fontSize: (square ? 32 : 40) * u, color: color.ink }}>
          <span style={{ color: color.ink3 }}>$ </span>
          {typed}
          <span style={{ opacity: caret ? 1 : 0, color: color.ink2 }}>▍</span>
        </div>
        <div style={{ marginTop: 30 * u }}>
          <Chip at={42} tone="bad">
            <Icon node={triangleAlert} at={44} size={30} tone="bad" strokeWidth={2} />
            NOT A REAL PACKAGE
          </Chip>
        </div>
        <div style={{ opacity: readout, marginTop: 22 * u, fontFamily: MONO, fontSize: (square ? 24 : 28) * u, color: color.ink2 }}>No such package on npm. This name does not exist.</div>
      </Frame>
    </AbsoluteFill>
  );
}

// lurq's real `check-upgrade` report for a file that imports `parse` from cookie.
export function Upgrade() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const strike = progress(frame, 30, 12);
  const renamed = progress(frame, 46);
  const size = (square ? 40 : 50) * u;
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground, flexDirection: square ? "column-reverse" : "row" }}>
      <div style={{ flex: 1.2, position: "relative" }}>
        <Frame style={{ gap: 30 * u }}>
          <Icon node={gitCompareArrows} at={2} size={square ? 64 : 80} />
          <Kicker index="07" label="Upgrades" at={4} />
          <div>
            <Chip at={12} tone="bad">BLOCKING · cookie 1.1.1 → 2.0.1</Chip>
          </div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 20 * u, fontFamily: MONO, fontSize: size }}>
            <span style={{ position: "relative", color: strike > 0.5 ? color.ink3 : color.ink }}>
              cookie.parse
              <span style={{ position: "absolute", left: 0, top: "52%", height: 3 * u, width: `${strike * 100}%`, background: color.bad }} />
            </span>
            <Icon node={arrowRight} at={40} size={square ? 40 : 50} tone="ink2" strokeWidth={2} />
            <span style={{ opacity: renamed, color: color.good }}>parseCookie</span>
          </div>
          <div style={{ opacity: renamed, fontFamily: MONO, fontSize: 22 * u, letterSpacing: "0.06em", color: color.ink3 }}>src/session.js:4 · a proven rename</div>
          <Words text="Passes your tests. Breaks in production." at={56} size={square ? 52 : 64} />
        </Frame>
      </div>
      <ClipPanel name="racks" from={square ? "top" : "right"} dim={0.3} />
    </AbsoluteFill>
  );
}

export function Everywhere() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const size = (square ? 116 : 96) * u;
  return (
    <AbsoluteFill>
      <Clip name="map" dim={0.82} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 80 * u, padding: `0 ${60 * u}px` }}>
        <Words text={IDE_HEADING} at={0} size={square ? 54 : 64} weight={500} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${square ? 3 : AGENT_LOGOS.length}, ${size * 1.9}px)`, rowGap: 48 * u, justifyContent: "center" }}>
          {AGENT_LOGOS.map((logo, i) => {
            const p = progress(frame, 16 + i * 3, 14);
            return (
              <div key={logo.file} style={{ opacity: p, transform: `scale(${0.7 + 0.3 * p})`, filter: `blur(${(1 - p) * 8}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
                {/* One tone for every mark, the way the site shows them. */}
                <Img src={staticFile(`logos/${logo.file}.svg`)} style={{ width: size * 0.6, height: size * 0.6, objectFit: "contain", filter: "brightness(0) invert(0.86)" }} />
                <div style={{ fontFamily: SANS, fontSize: 24 * u, color: color.ink2 }}>{logo.name}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function Close() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const headline = square ? 62 : 96;
  const line1Words = HEADLINE_LINE_1.split(" ").length;
  const pill = progress(frame, 44);
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 56 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
          <Mark size={64} />
          <div style={{ opacity: progress(frame, 8), fontFamily: MONO, fontWeight: 700, fontSize: 64 * u, color: color.ink }}>{WORDMARK}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <Words text={HEADLINE_LINE_1} at={12} size={headline} weight={500} style={{ whiteSpace: "nowrap" }} />
          <Words text={HEADLINE_LINE_2} at={12 + line1Words * 3} size={headline} weight={500} tone="ink2" style={{ whiteSpace: "nowrap" }} />
        </div>
        <div style={{ opacity: pill, transform: `translateY(${(1 - pill) * 16}px)`, display: "flex", alignItems: "center", gap: 18 * u, background: color.ink, color: color.ground, borderRadius: 999, padding: `${22 * u}px ${44 * u}px`, fontFamily: MONO, fontWeight: 700, fontSize: 40 * u }}>
          <Icon node={shieldCheck} at={48} size={40} tone="good" strokeWidth={2} />
          <span style={{ color: color.ink3 }}>$</span>
          {INSTALL_COMMAND}
        </div>
        <div style={{ opacity: progress(frame, 56), fontFamily: SANS, fontSize: 34 * u, color: color.ink3 }}>lurq.run</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
