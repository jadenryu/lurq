import { createContext, Fragment, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MONO, SANS } from "./brand";
import { check, type IconNode } from "./icons";

type Tone = "ink" | "ink2" | "ink3" | "bad" | "good";

/** The frame rate every timing in this project is authored at. Video.tsx picks the output rate. */
export const BASE_FPS = 30;

/**
 * The current frame in 30fps units (fractional at higher output rates), so each animation keeps
 * its authored timing at 60 or 120fps and simply gets more in-between frames.
 */
export function useFrame(): number {
  return (useCurrentFrame() * BASE_FPS) / useVideoConfig().fps;
}

/** Height-relative unit: 1 at 1080px tall, so wide and square share one scale. */
export function useUnit(): number {
  return useVideoConfig().height / 1080;
}

export function useSquare(): boolean {
  const { width, height } = useVideoConfig();
  return width / height < 1.2;
}

/** A long, soft ease-out: things arrive and then take their time settling. */
const EASE = Easing.bezier(0.25, 1, 0.5, 1);
/** A steeper ease for 3D moves: quick off the mark, a long glide into place. */
const GLIDE = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 → 1 over `duration` frames starting at `start`, eased and clamped. */
export function progress(frame: number, start: number, duration = 36, easing = EASE): number {
  return interpolate(frame, [start, start + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

/** Set by Video.tsx around each scene, so its words can hold until the picture changes. */
export const SceneTiming = createContext({ frames: 0, cut: 0, last: true });

/** 0 while the scene holds, easing to 1 across the transition into the next one. */
function useExit(): number {
  const frame = useFrame();
  const { frames, cut, last } = useContext(SceneTiming);
  return last ? 0 : progress(frame, frames - cut - 8, cut + 8, Easing.inOut(Easing.quad));
}

/** The site's dark ground with its two blooms, drifting so a held frame never looks frozen. */
export function Ground() {
  const frame = useFrame();
  const d = Math.sin(frame / 90) * 4;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${22 + d}% ${18 - d}%, ${color.bloomFrom}, transparent 55%), radial-gradient(circle at ${80 - d}% ${86 + d}%, ${color.bloomTo}, transparent 55%), ${color.ground}`,
      }}
    />
  );
}

/**
 * Footage under one cool grade, so every clip reads as the same film. `letterbox` draws
 * scope bars in on the wide cut and adds a lateral drone drift; a warm light leak crosses
 * the frame once. The grade and leak are blend layers (composited), not CSS filters.
 */
export function Clip({ name, shade = 0.5, focus = "center", zoom = 1, origin = "50% 50%", rate = 0.8, letterbox = false, drift = 1 }: { name: string; shade?: number; focus?: string; zoom?: number; origin?: string; rate?: number; letterbox?: boolean; drift?: number }) {
  const frame = useFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const u = useUnit();
  const square = useSquare();
  const bars = letterbox && !square ? progress(frame, 0, 40) * 100 * u : 0;
  const leak = progress(frame, 0, Math.max(60, (durationInFrames * BASE_FPS) / fps), Easing.inOut(Easing.sin));
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translateX(${letterbox ? frame * 0.25 * drift * u : 0}px) scale(${(1.1 + frame * 0.0005) * zoom})`, transformOrigin: origin }}>
        <OffthreadVideo muted playbackRate={rate} src={staticFile(`clips/${name}.mp4`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focus }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#16203a", mixBlendMode: "color", opacity: 0.35 }} />
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${-20 + leak * 140}% 30%, rgba(245,120,40,0.35), transparent 45%)`, mixBlendMode: "screen" }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 42%, rgba(8,8,10,${shade * 0.25}) 0%, rgba(8,8,10,${shade}) 72%, rgba(8,8,10,${Math.min(0.95, shade + 0.35)}) 100%)` }} />
      {bars > 0 && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bars, background: "#000" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bars, background: "#000" }} />
        </>
      )}
    </AbsoluteFill>
  );
}

/** The content layer: a slow upward drift while it holds, then a fade across the transition. */
export function Frame({ children, justify = "flex-end", align = "flex-start", style }: { children: ReactNode; justify?: CSSProperties["justifyContent"]; align?: CSSProperties["alignItems"]; style?: CSSProperties }) {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const exit = useExit();
  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        justifyContent: justify,
        alignItems: align,
        padding: `${(square ? 90 : 120) * u}px ${(square ? 76 : 140) * u}px`,
        transform: `translateY(${(-frame * 0.03 - exit * 12) * u}px)`,
        opacity: 1 - exit,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** A super: each word swings up into place in 3D, out of a soft blur, and then holds. */
export function Words({ text, at, size, weight = 600, tone = "ink", stagger = 6, style }: { text: string; at: number; size: number; weight?: number; tone?: Tone; stagger?: number; style?: CSSProperties }) {
  const frame = useFrame();
  const u = useUnit();
  return (
    <div style={{ fontFamily: SANS, fontWeight: weight, fontSize: size * u, lineHeight: 1.06, letterSpacing: "-0.04em", color: color[tone], textWrap: "balance", ...style }}>
      {text.split(" ").map((word, i) => {
        const p = progress(frame, at + i * stagger, 44, GLIDE);
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            <span
              style={{
                display: "inline-block",
                opacity: p,
                transformOrigin: "50% 100%",
                transform: `perspective(${900 * u}px) rotateX(${(1 - p) * -80}deg) translateY(${(1 - p) * 0.2}em)`,
                filter: p < 1 ? `blur(${(1 - p) * 6}px)` : undefined,
              }}
            >
              {word}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The source of a claim, small along the bottom edge, as ads footnote one. */
export function Footnote({ children, at }: { children: ReactNode; at: number }) {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const exit = useExit();
  return (
    <div style={{ position: "absolute", left: (square ? 76 : 140) * u, bottom: (square ? 40 : 52) * u, opacity: progress(frame, at, 30) * 0.7 * (1 - exit), fontFamily: SANS, fontSize: 18 * u, color: color.ink2 }}>
      {children}
    </div>
  );
}

/** A Lucide icon that draws its strokes in. */
export function Icon({ node, at, size, tone = "ink", strokeWidth = 1.5 }: { node: IconNode; at: number; size: number; tone?: Tone; strokeWidth?: number }) {
  const frame = useFrame();
  const u = useUnit();
  const p = progress(frame, at, 44, Easing.inOut(Easing.cubic));
  return (
    <svg width={size * u} height={size * u} viewBox="0 0 24 24" fill="none" stroke={color[tone]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {node.map(([Tag, attrs], i) => (
        <Tag key={i} {...attrs} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      ))}
    </svg>
  );
}

// The lurq mark as filled shapes, measured corner by corner off apps/web/public/logos/logo.png
// (a 2000px raster) in its own pixel space. The two chevrons tile exactly: the grey one's
// top end sits on the white one's inner corner, and its inner corner on the white one's lower end.
const MARK_BOX = { x: 623, y: 465, w: 685, h: 1002 };
const MARK_FRONT = "991,465 1097,571 835,833 1097,1097 991,1203 623,833";
const MARK_BACK = "941,728 1308,1097 941,1467 835,1361 1097,1097 835,834";
/** logo.png's grey on its black ground. */
const MARK_GREY = "#8a8a8a";

/** The lurq mark, flat, at `size` px tall (in 1080p units). */
export function LogoMark({ size, front = color.ink, back = MARK_GREY }: { size: number; front?: string; back?: string }) {
  const u = useUnit();
  return (
    <svg width={((size * MARK_BOX.w) / MARK_BOX.h) * u} height={size * u} viewBox={`${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.w} ${MARK_BOX.h}`} style={{ display: "block" }}>
      <polygon points={MARK_BACK} fill={back} />
      <polygon points={MARK_FRONT} fill={front} />
    </svg>
  );
}

/**
 * The lurq mark as a solid object: copies of the flat mark stacked back in depth (dark sides,
 * lit face), swinging round to face the camera and then turning gently, like a product hero.
 */
export function Logo3D({ size, at = 0 }: { size: number; at?: number }) {
  const frame = useFrame();
  const u = useUnit();
  const p = progress(frame, at, 80, GLIDE);
  const t = Math.max(0, frame - at);
  const ry = (1 - p) * -120 + Math.sin(t / 50) * 10 * p;
  const rx = (1 - p) * 30 + Math.cos(t / 70) * 4 * p;
  const layers = 16;
  const step = (size * u) / 90;
  return (
    <div style={{ perspective: 1400 * u, opacity: progress(frame, at, 20) }}>
      <div style={{ position: "relative", width: ((size * MARK_BOX.w) / MARK_BOX.h) * u, height: size * u, transformStyle: "preserve-3d", transform: `rotateX(${rx}deg) rotateY(${ry}deg) scale(${0.6 + 0.4 * p})` }}>
        {Array.from({ length: layers }, (_, k) => layers - 1 - k).map((i) => (
          <div key={i} style={{ position: "absolute", inset: 0, transform: `translateZ(${(layers / 2 - i) * step}px)` }}>
            {i === 0 ? <LogoMark size={size} /> : <LogoMark size={size} front={`rgb(${70 - i * 2},${70 - i * 2},${76 - i * 2})`} back={`rgb(${44 - i},${44 - i},${48 - i})`} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A verdict badge: settles in from slightly small, with no bounce. */
export function Chip({ children, at, tone }: { children: ReactNode; at: number; tone: Tone }) {
  const frame = useFrame();
  const u = useUnit();
  const s = frame < at ? 0 : spring({ frame: frame - at, fps: BASE_FPS, config: { damping: 200, mass: 1.4 } });
  return (
    <div
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 14 * u,
        opacity: s,
        transform: `scale(${0.94 + 0.06 * s})`,
        transformOrigin: "left center",
        padding: `${12 * u}px ${24 * u}px`,
        borderRadius: 999,
        border: `1px solid ${color[tone]}66`,
        background: `${color[tone]}1a`,
        color: color[tone],
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: 26 * u,
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Light behind the brand reveal: a soft bloom opens up and faint rays turn slowly around it,
 * like a stage light coming up on the logo.
 */
export function LightBurst({ at }: { at: number }) {
  const frame = useFrame();
  const u = useUnit();
  const p = progress(frame, at, 70, GLIDE);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 1800 * u,
          height: 1800 * u,
          opacity: p,
          transform: `scale(${0.55 + 0.45 * p}) rotate(${frame * 0.06}deg)`,
          background: "repeating-conic-gradient(from 0deg, rgba(255,255,255,0.055) 0deg 2.5deg, transparent 2.5deg 14deg)",
          maskImage: "radial-gradient(circle, #000 0%, rgba(0,0,0,0.6) 25%, transparent 58%)",
          WebkitMaskImage: "radial-gradient(circle, #000 0%, rgba(0,0,0,0.6) 25%, transparent 58%)",
        }}
      />
      <div style={{ position: "absolute", width: 1000 * u, height: 1000 * u, borderRadius: "50%", opacity: p, transform: `scale(${0.5 + 0.5 * p})`, background: "radial-gradient(circle, rgba(120,150,255,0.22), transparent 62%)" }} />
    </AbsoluteFill>
  );
}

/** Where a card's satellite tags float, as [x, y] offsets from the card's centre (1080p units). */
// Wide: beside the card, clear of the headline above it. Square: in two rows under the card.
const SATELLITES_WIDE = [[-700, -80], [740, -20], [-700, 170], [740, 210]];
const SATELLITES_SQUARE = [[-230, 240], [240, 260], [-220, 350], [250, 370]];

/**
 * How a card reacts to its own story beat, so no two cards light the same way:
 * - `danger`: the glow under the card and its edge turn red and pulse (the agent's bad install).
 * - `trace`: a point of light runs once around the card's edge while lurq checks.
 * - `resolve`: the glow turns red at the blocking verdict, then green once the fix is proven.
 */
export type Accent = { kind: "danger"; at: number } | { kind: "trace"; at: number } | { kind: "resolve"; at: number; resolvedAt: number };

const RED = "248,113,113";
const GREEN = "74,222,128";

/**
 * The product shot, staged in 3D: a glass panel flies in from depth and swings round to face
 * the camera, then keeps turning slowly while the named checks float in around it on their own
 * depth planes. `agent` titles it as the coding agent's terminal instead of lurq's.
 */
export function ProductCard({ at, label, agent = false, checks = [], accent, children }: { at: number; label: string; agent?: boolean; checks?: string[]; accent?: Accent; children: ReactNode }) {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const p = progress(frame, at, 84, GLIDE);
  const t = Math.max(0, frame - at);
  const ry = (1 - p) * -34 + Math.sin(t / 80) * 6 * p;
  const rx = (1 - p) * 20 + 3 + Math.cos(t / 100) * 2 * p;
  const lit = accent && accent.kind !== "trace" ? progress(frame, accent.at, 30) : 0;
  const green = accent?.kind === "resolve" ? progress(frame, accent.resolvedAt, 36) : 0;
  const red = accent?.kind === "danger" ? lit * (0.75 + 0.25 * Math.sin((frame - accent.at) / 8)) : lit * (1 - green);
  const trace = accent?.kind === "trace" ? progress(frame, accent.at, 60, Easing.inOut(Easing.cubic)) : 0;
  const spots = square ? SATELLITES_SQUARE : SATELLITES_WIDE;
  return (
    <div style={{ perspective: 2200 * u }}>
      <div style={{ position: "relative", transformStyle: "preserve-3d", transform: `translateZ(${(1 - p) * -700 * u}px) rotateX(${rx}deg) rotateY(${ry}deg)`, opacity: Math.min(1, p * 1.6) }}>
        <div style={{ position: "absolute", inset: `${-120 * u}px`, transform: `translateZ(${-120 * u}px)`, opacity: 1 - Math.max(red, green) * 0.8, background: `radial-gradient(ellipse at 50% 55%, ${agent ? "rgba(255,255,255,0.06)" : color.bloomTo}, transparent 65%)` }} />
        {red > 0 && <div style={{ position: "absolute", inset: `${-140 * u}px`, transform: `translateZ(${-120 * u}px)`, opacity: red, background: `radial-gradient(ellipse at 50% 55%, rgba(${RED},0.45), transparent 62%)` }} />}
        {green > 0 && <div style={{ position: "absolute", inset: `${-140 * u}px`, transform: `translateZ(${-120 * u}px)`, opacity: green, background: `radial-gradient(ellipse at 50% 55%, rgba(${GREEN},0.28), transparent 62%)` }} />}
        <div
          style={{
            position: "relative",
            width: (square ? 940 : 1180) * u,
            background: "linear-gradient(180deg, rgba(30,30,34,0.96) 0%, rgba(14,14,17,0.98) 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderTopColor: "rgba(255,255,255,0.22)",
            borderRadius: 28 * u,
            boxShadow: `0 ${60 * u}px ${160 * u}px rgba(0,0,0,0.6)`,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${22 * u}px ${36 * u}px`, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            {agent ? (
              <span style={{ fontFamily: MONO, fontSize: 22 * u, color: color.ink2 }}>coding agent</span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12 * u }}>
                <LogoMark size={26} />
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22 * u, color: color.ink }}>lurq</span>
              </div>
            )}
            <span style={{ fontFamily: MONO, fontSize: 20 * u, letterSpacing: "0.12em", textTransform: "uppercase", color: color.ink3 }}>{label}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 26 * u, padding: `${40 * u}px ${44 * u}px ${48 * u}px` }}>{children}</div>
          {red > 0 && <AbsoluteFill style={{ borderRadius: 28 * u, boxShadow: `inset 0 0 0 ${2 * u}px rgba(${RED},${red * 0.55})` }} />}
          {green > 0 && <AbsoluteFill style={{ borderRadius: 28 * u, boxShadow: `inset 0 0 0 ${2 * u}px rgba(${GREEN},${green * 0.55})` }} />}
        </div>
        {trace > 0 && trace < 1 && (
          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible", filter: `drop-shadow(0 0 ${8 * u}px rgba(140,170,255,0.9))` }}>
            <rect x="0" y="0" width="100%" height="100%" rx={28 * u} fill="none" stroke="rgba(190,210,255,0.95)" strokeWidth={3 * u} pathLength={1} strokeDasharray="0.14 0.86" strokeDashoffset={-trace} strokeLinecap="round" opacity={Math.min(1, trace * 8, (1 - trace) * 8)} />
          </svg>
        )}
        {checks.map((text, i) => {
          const q = progress(frame, at + 70 + i * 10, 50, GLIDE);
          const [x, y] = spots[i % spots.length];
          const bob = Math.sin((frame + i * 40) / 40) * 8;
          return (
            <div
              key={text}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                opacity: q,
                transform: `translate(-50%, -50%) translate3d(${x * u}px, ${(y + bob) * u}px, ${(180 - (1 - q) * 500) * u}px)`,
                display: "flex",
                alignItems: "center",
                gap: 10 * u,
                padding: `${12 * u}px ${20 * u}px`,
                borderRadius: 999,
                background: "rgba(28,28,32,0.9)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.5)`,
                fontFamily: MONO,
                fontSize: 22 * u,
                color: color.ink2,
                whiteSpace: "nowrap",
              }}
            >
              <Icon node={check} at={at + 90 + i * 10} size={22} tone="ink" strokeWidth={2.2} />
              {text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A line of terminal input typing out at a human pace, with a blinking caret while it types. */
export function Typed({ text, at, size, until }: { text: string; at: number; size: number; until: number }) {
  const frame = useFrame();
  const u = useUnit();
  const shown = text.slice(0, Math.max(0, Math.floor(((frame - at) / BASE_FPS) * 28)));
  const caret = frame < until && Math.floor(frame / 14) % 2 === 0;
  return (
    <div style={{ fontFamily: MONO, fontSize: size * u, color: color.ink, whiteSpace: "nowrap" }}>
      <span style={{ color: color.ink3 }}>$ </span>
      {shown}
      <span style={{ opacity: caret ? 1 : 0, color: color.ink2 }}>▍</span>
    </div>
  );
}

/**
 * The agent logos on a real 3D ring, tilted slightly toward the camera and turning. Each logo faces
 * outward with its back hidden, so only the front arc shows and logos fade as they turn edge-on:
 * nothing overlaps.
 */
export function Carousel3D({ at, items }: { at: number; items: { file: string; name: string }[] }) {
  const frame = useFrame();
  const u = useUnit();
  const square = useSquare();
  const radius = (square ? 380 : 620) * u;
  const intro = progress(frame, at, 60, GLIDE);
  const step = 360 / items.length;
  // Fast enough that most of the ring passes the front while the scene holds.
  const turn = -(frame - at) * 1.1 - (1 - intro) * 70;
  const logo = (square ? 110 : 100) * u;
  return (
    <div style={{ perspective: 2000 * u, width: radius * 2.6, height: 320 * u, opacity: intro }}>
      <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transform: `translateZ(${-radius}px) rotateX(-10deg) rotateY(${turn}deg)` }}>
        {items.map((item, i) => {
          const facing = Math.cos(((i * step + turn) * Math.PI) / 180);
          return (
            <div
              key={item.file}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 260 * u,
                marginLeft: -130 * u,
                marginTop: -100 * u,
                transform: `rotateY(${i * step}deg) translateZ(${radius}px)`,
                backfaceVisibility: "hidden",
                opacity: Math.max(0, Math.min(1, facing * 1.8)),
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 18 * u,
              }}
            >
              {/* One tone for every mark, the way the site shows them. */}
              <Img src={staticFile(`logos/${item.file}.svg`)} style={{ width: logo * 0.62, height: logo * 0.62, objectFit: "contain", filter: "brightness(0) invert(1)" }} />
              <div style={{ fontFamily: SANS, fontSize: 26 * u, color: color.ink, whiteSpace: "nowrap" }}>{item.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
