import { AbsoluteFill, Easing, useCurrentFrame } from "remotion";
import { AGENT_LOGOS, color, HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, MONO, SANS, WORDMARK } from "./brand";
import { Carousel3D, Chip, Clip, Footnote, Frame, Ground, Icon, Logo3D, ProductCard, progress, Sweep, Typed, useSquare, useUnit, Words } from "./components";
import { arrowRight, shieldCheck, triangleAlert } from "./icons";

/*
 * The one number is quoted from its source, footnoted on screen: Spracklen et al., "We Have a
 * Package for You!", USENIX Security 2025. Open-source code models hallucinated at least 21.7%
 * of the packages they suggested, on average, which is "more than 1 in 5".
 *
 * The floating check names are what lurq actually evaluates (see the lurq MCP tool descriptions
 * and src/surface/upgrade.ts): hallucinated and typosquatted names, advisories and deprecations
 * for verify; proven renames, removed symbols, call arity and a type check for check-upgrade.
 */

// A name that is not on npm (checked against the registry). The verdict lines are
// lurq's real `verify` output for it.
const FAKE_PACKAGE = "next-auth-session-helpers";

/** Size of a full-frame super over footage. */
function useSuperSize(): number {
  return useSquare() ? 84 : 112;
}

/** Bottom padding that keeps a super clear of the letterbox bar. */
function useAboveBars(): number {
  return (useSquare() ? 90 : 190) * useUnit();
}

export function Skyline() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      <Clip name="night" shade={0.3} letterbox drift={-1} />
      <Frame style={{ paddingBottom: useAboveBars() }}>
        <Words text="Every company runs on software." at={30} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Agents() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      <Clip name="tower" shade={0.35} letterbox />
      <Frame style={{ paddingBottom: useAboveBars() }}>
        <Words text="Now agents write it." at={14} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function CloseUp() {
  return (
    <AbsoluteFill>
      {/* Framed tight on the code, pushing both monitor makers' names (left edge, lower right) out of frame. */}
      <Clip name="screens" shade={0.5} rate={0.7} zoom={1.6} origin="45% 0%" />
      <Frame>
        <Words text="Fast." at={10} size={useSuperSize()} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Guess() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 48 * u }}>
        <Words text="But agents guess." at={108} size={square ? 70 : 92} style={{ textAlign: "center" }} />
        <ProductCard at={4} label="install" agent>
          <div style={{ fontFamily: MONO, fontSize: (square ? 24 : 28) * u, color: color.ink2 }}>● I'll add a helper package for sessions.</div>
          <Typed text={`npm install ${FAKE_PACKAGE}`} at={40} size={square ? 30 : 38} until={104} />
        </ProductCard>
        <Words text="More than 1 in 5 packages suggested by open-source models are made up." at={140} size={square ? 30 : 36} weight={500} tone="ink2" stagger={3} style={{ textAlign: "center", maxWidth: 1100 * u }} />
      </Frame>
      <Footnote at={150}>Spracklen et al., USENIX Security 2025</Footnote>
    </AbsoluteFill>
  );
}

export function Meet() {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const word = progress(frame, 46, 60, Easing.bezier(0.16, 1, 0.3, 1));
  return (
    <AbsoluteFill>
      <Ground />
      <Sweep at={80} duration={80} />
      <Frame justify="center" align="center" style={{ gap: 36 * u }}>
        <Words text="Meet" at={4} size={square ? 44 : 52} weight={500} tone="ink3" />
        <div style={{ display: "flex", alignItems: "center", gap: 48 * u }}>
          <Logo3D size={square ? 150 : 200} at={10} />
          <div style={{ perspective: 1200 * u }}>
            <div style={{ opacity: word, transform: `translateZ(${(1 - word) * -400 * u}px) rotateY(${(1 - word) * 40}deg)`, transformOrigin: "0% 50%", letterSpacing: "-0.02em", fontFamily: MONO, fontWeight: 700, fontSize: (square ? 150 : 200) * u, color: color.ink }}>{WORDMARK}</div>
          </div>
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
      <Frame justify="center" align="center" style={{ gap: 70 * u }}>
        <Words text="It checks every package before it's installed." at={8} size={square ? 52 : 66} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={30} label="verify" checks={["made-up names", "typosquats", "advisories", "deprecations"]}>
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

export function Flyover() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      <Clip name="flyover" shade={0.35} letterbox drift={-1} />
      <Frame style={{ paddingBottom: useAboveBars() }}>
        <Words text="Every install, verified." at={14} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
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
      <Frame justify="center" align="center" style={{ gap: 70 * u }}>
        <Words text="Every upgrade, checked before it ships." at={8} size={square ? 52 : 66} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={30} label="check-upgrade" checks={["proven renames", "removed symbols", "call arity", "type check"]}>
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
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Clip name="aerial" shade={0.72} />
      <Frame justify="center" align="center" style={{ gap: 60 * u }}>
        <Words text={IDE_HEADING} at={10} size={square ? 58 : 72} style={{ textAlign: "center", maxWidth: 1400 * u }} />
        <Carousel3D at={36} items={AGENT_LOGOS} />
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
  const wordmark = progress(frame, 40, 40);
  const pill = progress(frame, 120, 40);
  return (
    <AbsoluteFill>
      <Clip name="dusk" shade={0.66} />
      <Frame justify="center" align="center" style={{ gap: 56 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 * u }}>
          <Logo3D size={90} at={4} />
          <div style={{ opacity: wordmark, fontFamily: MONO, fontWeight: 700, fontSize: 80 * u, color: color.ink }}>{WORDMARK}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <Words text={HEADLINE_LINE_1} at={50} size={headline} weight={500} style={{ whiteSpace: "nowrap" }} />
          <Words text={HEADLINE_LINE_2} at={50 + line1Words * 6} size={headline} weight={500} tone="ink2" style={{ whiteSpace: "nowrap" }} />
        </div>
        <div style={{ opacity: pill, transform: `translateY(${(1 - pill) * 18 * u}px)`, display: "flex", alignItems: "center", gap: 18 * u, background: color.ink, color: color.ground, borderRadius: 999, padding: `${22 * u}px ${44 * u}px`, fontFamily: MONO, fontWeight: 700, fontSize: 40 * u }}>
          <Icon node={shieldCheck} at={128} size={40} tone="good" strokeWidth={2} />
          <span style={{ color: color.ink3 }}>$</span>
          {INSTALL_COMMAND}
        </div>
        <div style={{ opacity: progress(frame, 146, 36), fontFamily: SANS, fontSize: 34 * u, color: color.ink2 }}>lurq.run</div>
      </Frame>
    </AbsoluteFill>
  );
}
