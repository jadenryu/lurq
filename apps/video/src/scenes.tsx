import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from "remotion";
import { AGENT_LOGOS, color, HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, MONO, SANS, WORDMARK } from "./brand";
import { Chip, Clip, Footnote, Frame, Ground, Icon, Mark, ProductCard, progress, Sweep, Typed, useSquare, useUnit, Words } from "./components";
import { arrowRight, shieldCheck, triangleAlert } from "./icons";

/*
 * The one number is quoted from its source, footnoted on screen: Spracklen et al., "We Have a
 * Package for You!", USENIX Security 2025. Open-source code models hallucinated at least 21.7%
 * of the packages they suggested, on average, which is "more than 1 in 5".
 */

// A name that is not on npm (checked against the registry). The verdict lines are
// lurq's real `verify` output for it.
const FAKE_PACKAGE = "next-auth-session-helpers";

/** Size of a full-frame super over footage. */
function useSuperSize(): number {
  return useSquare() ? 84 : 112;
}

export function Open() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      <Clip name="screens" shade={0.5} />
      <Frame>
        <Words text="Your agent writes the code." at={24} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Picks() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      {/* Framed toward the cup, pushing the laptop's model name on the bezel out of frame. */}
      <Clip name="coffee" shade={0.5} zoom={1.5} origin="0% 20%" />
      <Frame>
        <Words text="It picks the packages, too." at={16} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Guess() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 48 * u }}>
        <Words text="Some of them don't exist." at={100} size={square ? 64 : 84} style={{ textAlign: "center" }} />
        <ProductCard at={4} label="install" agent>
          <div style={{ fontFamily: MONO, fontSize: (square ? 24 : 28) * u, color: color.ink2 }}>● I'll add a helper package for sessions.</div>
          <Typed text={`npm install ${FAKE_PACKAGE}`} at={40} size={square ? 30 : 38} until={100} />
        </ProductCard>
        <Words text="More than 1 in 5 packages suggested by open-source models are made up." at={128} size={square ? 30 : 36} weight={500} tone="ink2" stagger={3} style={{ textAlign: "center", maxWidth: 1100 * u, opacity: frame < 128 ? 0 : 1 }} />
      </Frame>
      <Footnote at={140}>Spracklen et al., USENIX Security 2025</Footnote>
    </AbsoluteFill>
  );
}

export function Meet() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const word = progress(frame, 34, 50);
  return (
    <AbsoluteFill>
      <Ground />
      <Sweep at={50} duration={80} />
      <Frame justify="center" align="center" style={{ gap: 28 * u }}>
        <Words text="Meet" at={4} size={square ? 44 : 52} weight={500} tone="ink3" />
        <div style={{ display: "flex", alignItems: "center", gap: 36 * u }}>
          <Mark size={square ? 130 : 170} at={14} />
          <div style={{ opacity: word, letterSpacing: `${-0.01 + (1 - word) * 0.2}em`, fontFamily: MONO, fontWeight: 700, fontSize: (square ? 140 : 180) * u, color: color.ink }}>{WORDMARK}</div>
        </div>
      </Frame>
    </AbsoluteFill>
  );
}

export function VerifyShot() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 56 * u }}>
        <Words text="It checks every package before it's installed." at={10} size={square ? 54 : 70} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={34} label="verify">
          <Typed text={`lurq verify ${FAKE_PACKAGE}`} at={60} size={square ? 30 : 38} until={118} />
          <Chip at={120} tone="bad">
            <Icon node={triangleAlert} at={124} size={30} tone="bad" strokeWidth={2} />
            NOT A REAL PACKAGE
          </Chip>
          <div style={{ opacity: progress(frame, 136, 30), fontFamily: MONO, fontSize: (square ? 22 : 26) * u, color: color.ink2 }}>No such package on npm. This name does not exist.</div>
        </ProductCard>
      </Frame>
    </AbsoluteFill>
  );
}

export function Interlude() {
  return (
    <AbsoluteFill>
      <Clip name="typing" shade={0.5} />
      <Frame>
        <Words text="So you can keep moving fast." at={16} size={useSuperSize()} />
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
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 56 * u }}>
        <Words text="And every upgrade, checked before it ships." at={10} size={square ? 54 : 70} style={{ textAlign: "center", maxWidth: 1300 * u }} />
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
      <Ground />
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
    <AbsoluteFill>
      <Ground />
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
