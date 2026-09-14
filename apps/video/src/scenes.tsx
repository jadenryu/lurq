import { AbsoluteFill, Easing, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AGENT_LOGOS, color, HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, MONO, SANS, WORDMARK } from "./brand";
import { Chip, Clip, Counter, Footnote, Frame, Icon, Mark, ProductCard, progress, Sweep, useSquare, useUnit, Words } from "./components";
import { arrowRight, shieldCheck, triangleAlert } from "./icons";

/*
 * The two numbers are quoted from their sources, which are footnoted on screen:
 * - Spracklen et al., "We Have a Package for You!", USENIX Security 2025: open-source code models
 *   hallucinated at least 21.7% of the packages they suggested, on average (so "more than 1 in 5").
 * - Sonatype, 2026 State of the Software Supply Chain: 454,600+ new malicious packages found in 2025.
 */

// A name that is not on npm (checked against the registry). The verdict lines are
// lurq's real `verify` output for it.
const FAKE_PACKAGE = "next-auth-session-helpers";

/** Size of a full-frame super. */
function useSuperSize(): number {
  return useSquare() ? 80 : 108;
}

export function Office() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      {/* Framed up and left of the monitor brand names in this shot. */}
      <Clip name="office" shade={0.4} zoom={1.3} origin="0% 55%" />
      <Frame>
        <Words text="Your team ships faster than ever." at={18} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Agents() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      {/* A cut on the action, from the team to the keyboard. */}
      <Sequence durationInFrames={78}>
        <Clip name="laugh" shade={0.4} />
      </Sequence>
      <Sequence from={78}>
        <Clip name="typing" shade={0.45} />
      </Sequence>
      <Frame>
        <Words text="Because agents write the code now." at={16} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Guess() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      {/* Framed above the monitor maker's name along the bottom edge. */}
      <Clip name="late" shade={0.55} zoom={1.12} origin="50% 0%" />
      <Frame>
        <Words text="But agents guess." at={14} size={useSuperSize()} />
        <Words text="More than 1 in 5 packages suggested by open-source models don't exist." at={66} size={square ? 44 : 54} weight={500} tone="ink2" stagger={4} style={{ marginTop: 28 * u, maxWidth: 1150 * u }} />
      </Frame>
      <Footnote at={80}>Spracklen et al., USENIX Security 2025</Footnote>
    </AbsoluteFill>
  );
}

export function Threat() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Clip name="focus" shade={0.62} />
      <Frame>
        <Counter to={454600} at={12} size={square ? 190 : 260} />
        <Words text="malicious open-source packages were found in 2025." at={44} size={square ? 48 : 60} weight={500} style={{ marginTop: 22 * u, maxWidth: 1150 * u }} />
      </Frame>
      <Footnote at={70}>Sonatype, 2026 State of the Software Supply Chain</Footnote>
    </AbsoluteFill>
  );
}

export function Meet() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const word = progress(frame, 34, 50);
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground }}>
      <Sweep at={50} duration={80} />
      <Frame justify="center" align="center" style={{ gap: 28 * u }}>
        <Words text="Meet" at={4} size={square ? 44 : 52} weight={500} tone="ink3" />
        <div style={{ display: "flex", alignItems: "center", gap: 36 * u }}>
          <Mark size={square ? 130 : 170} at={14} />
          <div style={{ opacity: word, filter: word < 1 ? `blur(${(1 - word) * 10}px)` : undefined, letterSpacing: `${-0.01 + (1 - word) * 0.2}em`, fontFamily: MONO, fontWeight: 700, fontSize: (square ? 140 : 180) * u, color: color.ink }}>{WORDMARK}</div>
        </div>
      </Frame>
    </AbsoluteFill>
  );
}

export function VerifyShot() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const square = useSquare();
  const command = `lurq verify ${FAKE_PACKAGE}`;
  const typed = command.slice(0, Math.max(0, Math.floor(((frame - 60) / fps) * 30)));
  const caret = frame < 116 && Math.floor(frame / 14) % 2 === 0;
  return (
    <AbsoluteFill>
      <Clip name="coffee" shade={0.72} />
      <Frame justify="center" align="center" style={{ gap: 56 * u }}>
        <Words text="It checks every package before it's installed." at={10} size={square ? 54 : 70} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={34} label="verify">
          <div style={{ fontFamily: MONO, fontSize: (square ? 30 : 38) * u, color: color.ink, whiteSpace: "nowrap" }}>
            <span style={{ color: color.ink3 }}>$ </span>
            {typed}
            <span style={{ opacity: caret ? 1 : 0, color: color.ink2 }}>▍</span>
          </div>
          <Chip at={118} tone="bad">
            <Icon node={triangleAlert} at={122} size={30} tone="bad" strokeWidth={2} />
            NOT A REAL PACKAGE
          </Chip>
          <div style={{ opacity: progress(frame, 132, 30), fontFamily: MONO, fontSize: (square ? 22 : 26) * u, color: color.ink2 }}>No such package on npm. This name does not exist.</div>
        </ProductCard>
      </Frame>
    </AbsoluteFill>
  );
}

export function Install() {
  return (
    <AbsoluteFill>
      <Clip name="hands" shade={0.45} />
      <Frame>
        <Words text="Every install, verified." at={16} size={useSuperSize()} />
      </Frame>
    </AbsoluteFill>
  );
}

// lurq's real `check-upgrade` report for a file that imports `parse` from cookie.
export function UpgradeShot() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const strike = progress(frame, 92, 30, Easing.inOut(Easing.cubic));
  const renamed = progress(frame, 120, 36);
  return (
    <AbsoluteFill>
      <Clip name="screens" shade={0.72} />
      <Frame justify="center" align="center" style={{ gap: 56 * u }}>
        <Words text="Every upgrade, checked before it ships." at={10} size={square ? 54 : 70} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={34} label="check-upgrade">
          <Chip at={62} tone="bad">BLOCKING · cookie 1.1.1 → 2.0.1</Chip>
          <div style={{ display: "flex", alignItems: "center", gap: 20 * u, fontFamily: MONO, fontSize: (square ? 34 : 42) * u, whiteSpace: "nowrap" }}>
            <span style={{ position: "relative", color: color.ink, opacity: 1 - strike * 0.55 }}>
              cookie.parse
              <span style={{ position: "absolute", left: 0, top: "52%", height: 3 * u, width: `${strike * 100}%`, background: color.bad }} />
            </span>
            <Icon node={arrowRight} at={108} size={square ? 34 : 42} tone="ink2" strokeWidth={2} />
            <span style={{ opacity: renamed, color: color.good }}>parseCookie</span>
          </div>
          <div style={{ opacity: progress(frame, 136, 30), fontFamily: MONO, fontSize: (square ? 22 : 26) * u, color: color.ink2 }}>src/session.js:4 · a proven rename</div>
        </ProductCard>
      </Frame>
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
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 0%, ${color.bloomTo}, transparent 65%), ${color.ground}` }} />
      <Frame justify="center" align="center" style={{ gap: 80 * u }}>
        <Words text={IDE_HEADING} at={10} size={square ? 58 : 72} style={{ textAlign: "center", maxWidth: 1400 * u }} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${square ? 3 : AGENT_LOGOS.length}, ${size * 1.9}px)`, rowGap: 48 * u, justifyContent: "center" }}>
          {AGENT_LOGOS.map((logo, i) => {
            const p = progress(frame, 50 + i * 6, 40);
            return (
              <div key={logo.file} style={{ opacity: p, transform: `translateY(${(1 - p) * 20 * u}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
                {/* One tone for every mark, the way the site shows them. */}
                <Img src={staticFile(`logos/${logo.file}.svg`)} style={{ width: size * 0.6, height: size * 0.6, objectFit: "contain", filter: "brightness(0) invert(1)" }} />
                <div style={{ fontFamily: SANS, fontSize: 24 * u, color: color.ink }}>{logo.name}</div>
              </div>
            );
          })}
        </div>
      </Frame>
    </AbsoluteFill>
  );
}

export function End() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const headline = square ? 64 : 100;
  const line1Words = HEADLINE_LINE_1.split(" ").length;
  const wordmark = progress(frame, 26, 40);
  const pill = progress(frame, 110, 40);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 120%, ${color.bloomTo}, transparent 60%), ${color.ground}` }}>
      <Frame justify="center" align="center" style={{ gap: 60 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
          <Mark size={64} at={6} />
          <div style={{ opacity: wordmark, fontFamily: MONO, fontWeight: 700, fontSize: 64 * u, color: color.ink }}>{WORDMARK}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <Words text={HEADLINE_LINE_1} at={40} size={headline} weight={500} style={{ whiteSpace: "nowrap" }} />
          <Words text={HEADLINE_LINE_2} at={40 + line1Words * 7} size={headline} weight={500} tone="ink2" style={{ whiteSpace: "nowrap" }} />
        </div>
        <div style={{ opacity: pill, transform: `translateY(${(1 - pill) * 18 * u}px)`, display: "flex", alignItems: "center", gap: 18 * u, background: color.ink, color: color.ground, borderRadius: 999, padding: `${22 * u}px ${44 * u}px`, fontFamily: MONO, fontWeight: 700, fontSize: 40 * u }}>
          <Icon node={shieldCheck} at={118} size={40} tone="good" strokeWidth={2} />
          <span style={{ color: color.ink3 }}>$</span>
          {INSTALL_COMMAND}
        </div>
        <div style={{ opacity: progress(frame, 136, 36), fontFamily: SANS, fontSize: 34 * u, color: color.ink3 }}>lurq.run</div>
      </Frame>
    </AbsoluteFill>
  );
}
