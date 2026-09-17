import { AbsoluteFill, Easing } from "remotion";
import { AGENT_LOGOS, color, HEADLINE_LINE_1, HEADLINE_LINE_2, IDE_HEADING, INSTALL_COMMAND, MONO, SANS, WORDMARK } from "./brand";
import { Carousel3D, Chip, Clip, Footnote, Frame, Ground, Icon, Logo3D, ProductCard, progress, Typed, useFrame, useSquare, useUnit, Words } from "./components";
import { arrowRight, check, shieldCheck } from "./icons";

/*
 * THE THESIS, and it is the landing page's: a model answers from memory, and the memory has a
 * date on it. The video's spine is code written for an API that has since moved, not a package
 * that never existed. Keep it that way; see content/copy.ts HEADLINE_LINE_1/2.
 *
 * Every number and every line of output on screen is real:
 *   - The zod delta is lurq's own answer for `usage zod --known 3.23.8` at 4.1.12: ZodEffects is
 *     gone, Schema is a proven rename to ZodType. diff_surface returns it verdict verified_true,
 *     read from shipped JavaScript.
 *   - The 2,805 is apps/web/src/content/generated/drift.json, newest-cutoff bucket, read on the
 *     date in the footnote. Do not add a number this file cannot point at.
 *
 * The floating check names are what lurq actually evaluates (see the lurq MCP tool descriptions
 * and src/surface/upgrade.ts): exported symbols, signatures, renames and removals for usage;
 * proven renames, removed symbols, call arity and a type check for check-upgrade.
 */

/** Size of a full-frame super over footage. */
function useSuperSize(): number {
  return useSquare() ? 84 : 112;
}

/** Bottom padding that keeps a super clear of the letterbox bar. */
function useAboveBars(): number {
  return (useSquare() ? 90 : 190) * useUnit();
}

/*
 * The footage tells one story in two kinds of shot. City clips are the scale (the world runs on
 * software) and always play letterboxed. Office clips are the people (the teams who build it) and
 * play full frame and close. They alternate around the product shots, never two cities in a row.
 */

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

export function Teams() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      {/* Framed to cut the PC case badge along the bottom edge and the monitor makers' names. */}
      <Clip name="office" shade={0.5} zoom={1.35} origin="0% 30%" />
      <Frame>
        <Words text="Built by teams that ship every day." at={16} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function CloseUp() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      {/* Framed tight on the code, pushing both monitor makers' names (left edge, lower right) out of frame. */}
      <Clip name="screens" shade={0.5} rate={0.7} zoom={1.6} origin="45% 0%" />
      <Frame>
        <Words text="Now agents write the code." at={10} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Memory() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 48 * u }}>
        <Words text="For the version it remembers." at={108} size={square ? 70 : 92} style={{ textAlign: "center" }} />
        <ProductCard at={4} label="write" agent accent={{ kind: "danger", at: 104 }}>
          <div style={{ fontFamily: MONO, fontSize: (square ? 24 : 28) * u, color: color.ink2 }}>● I'll wrap the schema in a ZodEffects.</div>
          <Typed text={`import { ZodEffects } from "zod"`} at={40} size={square ? 30 : 38} until={104} />
        </ProductCard>
        <Words text="2,805 packages the newest model knew have shipped a new major since its cutoff." at={140} size={square ? 30 : 36} weight={500} tone="ink2" stagger={3} style={{ textAlign: "center", maxWidth: 1100 * u }} />
      </Frame>
      <Footnote at={150}>lurq index, read 17 Sep 2026</Footnote>
    </AbsoluteFill>
  );
}

export function Meet() {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const word = progress(frame, 46, 60, Easing.bezier(0.16, 1, 0.3, 1));
  return (
    <AbsoluteFill>
      <Ground />
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

// lurq's real `usage zod --known 3.23.8` delta at 4.1.12, in the CLI's own output shape.
export function SurfaceShot() {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 70 * u }}>
        <Words text="It reads the API your installed version actually ships." at={8} size={square ? 52 : 66} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={30} label="usage" checks={["exported symbols", "signatures", "renames", "removals"]} accent={{ kind: "trace", at: 62 }}>
          <Typed text="lurq usage zod --known 3.23.8" at={60} size={square ? 30 : 38} until={118} />
          <Chip at={120} tone="good">
            <Icon node={check} at={124} size={30} tone="good" strokeWidth={2} />
            READ FROM THE SHIPPED CODE
          </Chip>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 * u, fontFamily: MONO, fontSize: (square ? 26 : 32) * u }}>
            <div style={{ opacity: progress(frame, 136, 26), color: color.bad }}>- ZodEffects</div>
            <div style={{ opacity: progress(frame, 152, 26), color: color.warn }}>~ Schema → ZodType</div>
          </div>
        </ProductCard>
      </Frame>
    </AbsoluteFill>
  );
}

export function Flyover() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      <Clip name="tower" shade={0.35} letterbox drift={-1} />
      <Frame style={{ paddingBottom: useAboveBars() }}>
        <Words text="Written for what's installed." at={14} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

// lurq's real `check-upgrade` report for a file that imports `parse` from cookie.
export function UpgradeShot() {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const strike = progress(frame, 92, 30, Easing.inOut(Easing.cubic));
  const renamed = progress(frame, 120, 36);
  return (
    <AbsoluteFill>
      <Ground />
      <Frame justify="center" align="center" style={{ gap: 70 * u }}>
        <Words text="Every upgrade, checked before it ships." at={8} size={square ? 52 : 66} style={{ textAlign: "center", maxWidth: 1300 * u }} />
        <ProductCard at={30} label="check-upgrade" checks={["proven renames", "removed symbols", "call arity", "type check"]} accent={{ kind: "resolve", at: 62, resolvedAt: 120 }}>
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

export function Keep() {
  const u = useUnit();
  return (
    <AbsoluteFill>
      <Clip name="typing" shade={0.45} rate={0.75} zoom={1.2} origin="0% 100%" />
      <Frame>
        <Words text="So your team keeps shipping." at={14} size={useSuperSize()} style={{ maxWidth: 1300 * u }} />
      </Frame>
    </AbsoluteFill>
  );
}

export function Everywhere() {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill>
      <Clip name="aerial" shade={0.72} letterbox />
      <Frame justify="center" align="center" style={{ gap: 60 * u }}>
        <Words text={IDE_HEADING} at={10} size={square ? 58 : 72} style={{ textAlign: "center", maxWidth: 1400 * u }} />
        <Carousel3D at={36} items={AGENT_LOGOS} />
      </Frame>
    </AbsoluteFill>
  );
}

export function End() {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const headline = square ? 64 : 100;
  const line1Words = HEADLINE_LINE_1.split(" ").length;
  const wordmark = progress(frame, 40, 40);
  const pill = progress(frame, 120, 40);
  return (
    <AbsoluteFill>
      <Clip name="dusk" shade={0.66} letterbox />
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
