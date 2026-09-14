import { createContext, Fragment, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MONO, SANS } from "./brand";
import type { IconNode } from "./icons";

type Tone = "ink" | "ink2" | "ink3" | "bad" | "good";

/** Height-relative unit: 1 at 1080px tall, so wide and square share one scale. */
export function useUnit(): number {
  return useVideoConfig().height / 1080;
}

export function useSquare(): boolean {
  const { width, height } = useVideoConfig();
  return width / height < 1.2;
}

/** A long, soft ease-out: things arrive quickly and take their time settling. */
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** 0 → 1 over `duration` frames starting at `start`, eased and clamped. */
export function progress(frame: number, start: number, duration = 24, easing = EASE): number {
  return interpolate(frame, [start, start + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

/** Set by Video.tsx around each scene, so content can leave before the cut instead of being cut off. */
export const SceneTiming = createContext({ frames: 0, cut: 0, last: true });

/** 0 while the scene holds, rising to 1 as its content clears ahead of the transition. */
function useExit(): number {
  const frame = useCurrentFrame();
  const { frames, cut, last } = useContext(SceneTiming);
  return last ? 0 : progress(frame, frames - cut - 18, 24, Easing.inOut(Easing.cubic));
}

/** The one look every clip shares: black and white, a little contrast, pulled down. */
const GRADE = "grayscale(1) contrast(1.18) brightness(0.8)";

/** Stock footage, full bleed and graded: a slow push-in with a slight lateral drift. */
export function Clip({ name, dim = 0.6, focus = "center", pan = 1 }: { name: string; dim?: number; focus?: string; pan?: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${1.08 + frame * 0.0004}) translateX(${frame * 0.06 * pan}px)` }}>
        <OffthreadVideo muted src={staticFile(`clips/${name}.mp4`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focus, filter: GRADE }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(8,8,10,${dim * 0.55}) 0%, rgba(8,8,10,${dim}) 50%, rgba(8,8,10,${Math.min(1, dim + 0.28)}) 100%)`,
          boxShadow: "inset 0 0 300px rgba(0,0,0,0.8)",
        }}
      />
    </AbsoluteFill>
  );
}

/** Footage in a panel that wipes open while the picture inside settles back to size. */
export function ClipPanel({ name, at = 0, from = "left", dim = 0.3 }: { name: string; at?: number; from?: "left" | "right" | "top"; dim?: number }) {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 48);
  const hidden = (1 - p) * 100;
  const inset = from === "left" ? `0 ${hidden}% 0 0` : from === "right" ? `0 0 0 ${hidden}%` : `0 0 ${hidden}% 0`;
  return (
    <div style={{ position: "relative", flex: 1, overflow: "hidden", clipPath: `inset(${inset})` }}>
      <AbsoluteFill style={{ transform: `scale(${1.18 - 0.18 * p})` }}>
        <Clip name={name} dim={dim} />
      </AbsoluteFill>
    </div>
  );
}

/**
 * The content layer. It drifts upward a touch slower than the footage pushes in, which
 * separates the words from the picture, and it lifts and blurs away before each cut.
 */
export function Frame({ children, justify = "center", style }: { children: ReactNode; justify?: CSSProperties["justifyContent"]; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const exit = useExit();
  return (
    <AbsoluteFill
      style={{
        flexDirection: "column",
        justifyContent: justify,
        padding: `${(square ? 84 : 120) * u}px ${(square ? 76 : 140) * u}px`,
        transform: `translateY(${(-frame * 0.05 - exit * 24) * u}px)`,
        opacity: 1 - exit,
        filter: exit > 0 ? `blur(${exit * 10}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** A caption that arrives one word at a time, each word rising out of a blur. */
export function Words({ text, at, size, weight = 600, tone = "ink", stagger = 5, style }: { text: string; at: number; size: number; weight?: number; tone?: Tone; stagger?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  return (
    <div style={{ fontFamily: SANS, fontWeight: weight, fontSize: size * u, lineHeight: 1.06, letterSpacing: "-0.035em", color: color[tone], textWrap: "balance", ...style }}>
      {text.split(" ").map((word, i) => {
        const p = progress(frame, at + i * stagger, 30);
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            <span style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 0.4}em)`, filter: `blur(${(1 - p) * 14}px)` }}>{word}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** A number that counts up, sharpening out of a blur as it lands. */
export function Counter({ to, at, size, suffix = "", tone = "ink", duration = 64 }: { to: number; at: number; size: number; suffix?: string; tone?: Tone; duration?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, at, duration, Easing.bezier(0.16, 1, 0.3, 1));
  const shown = progress(frame, at, 20);
  return (
    <div
      style={{
        opacity: shown,
        transform: `scale(${0.96 + 0.04 * p})`,
        transformOrigin: "left bottom",
        filter: `blur(${(1 - shown) * 16}px)`,
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: size * u,
        lineHeight: 0.9,
        letterSpacing: "-0.055em",
        color: color[tone],
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {Math.round(to * p).toLocaleString("en-US")}
      {suffix}
    </div>
  );
}

/** A chapter label: the index, a rule drawing out from it, then the name sliding in behind. */
export function Kicker({ index, label, at = 0 }: { index: string; label: string; at?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const rule = progress(frame, at + 4, 36);
  const name = progress(frame, at + 16, 30);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 * u, fontFamily: MONO, fontSize: 22 * u, letterSpacing: "0.16em", textTransform: "uppercase", color: color.ink3 }}>
      <span style={{ color: color.ink, opacity: progress(frame, at, 20) }}>{index}</span>
      <span style={{ width: 64 * u * rule, height: 1, background: color.ink3 }} />
      <span style={{ opacity: name, transform: `translateX(${(1 - name) * -12 * u}px)` }}>{label}</span>
    </div>
  );
}

/** Where a number came from, pinned to the bottom edge. */
export function Source({ children, at }: { children: ReactNode; at: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const exit = useExit();
  const p = progress(frame, at, 36);
  return (
    <div style={{ position: "absolute", left: (square ? 76 : 140) * u, bottom: (square ? 48 : 64) * u, display: "flex", alignItems: "center", gap: 14 * u, opacity: p * (1 - exit), fontFamily: MONO, fontSize: 18 * u, letterSpacing: "0.12em", textTransform: "uppercase", color: color.ink3 }}>
      <span style={{ width: 28 * u * p, height: 1, background: color.ink3 }} />
      Source · {children}
    </div>
  );
}

/** A horizontal bar filling to `value` percent, a lit point riding its leading edge. */
export function Bar({ value, at, style }: { value: number; at: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, at, 72, Easing.bezier(0.16, 1, 0.3, 1));
  return (
    <div style={{ position: "relative", height: 4 * u, background: "rgba(242,242,238,0.12)", borderRadius: 99, ...style }}>
      <div style={{ width: `${value * p}%`, height: "100%", background: color.ink, borderRadius: 99 }} />
      <div style={{ position: "absolute", left: `${value * p}%`, top: "50%", width: 12 * u, height: 12 * u, marginLeft: -6 * u, marginTop: -6 * u, borderRadius: 99, background: color.ink, boxShadow: `0 0 ${24 * u}px rgba(255,255,255,0.8)`, opacity: progress(frame, at, 12) }} />
    </div>
  );
}

/** A field of grey dots, each turning red on its own in a scattered, repeatable order. */
export function DotMatrix({ at, cols, rows, duration = 100 }: { at: number; cols: number; rows: number; duration?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const n = cols * rows;
  const lit = progress(frame, at, duration, Easing.inOut(Easing.quad)) * n * 1.1;
  const gap = 26 * u;
  return (
    <svg width={cols * gap} height={rows * gap} style={{ opacity: progress(frame, at - 10, 30) }}>
      {Array.from({ length: n }, (_, i) => {
        const on = Math.min(1, Math.max(0, (lit - ((i * 7919) % n)) / (n * 0.1)));
        const cx = (i % cols) * gap + gap / 2;
        const cy = Math.floor(i / cols) * gap + gap / 2;
        return (
          <Fragment key={i}>
            <circle cx={cx} cy={cy} r={2.2 * u} fill="rgba(242,242,238,0.22)" />
            <circle cx={cx} cy={cy} r={(2.2 + 2.6 * on) * u} fill={color.bad} opacity={on} />
          </Fragment>
        );
      })}
    </svg>
  );
}

/** A Lucide icon that draws its strokes in. */
export function Icon({ node, at, size, tone = "ink", strokeWidth = 1.5 }: { node: IconNode; at: number; size: number; tone?: Tone; strokeWidth?: number }) {
  const frame = useCurrentFrame();
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

/** The lurq mark (apps/web wordmark.tsx), its two chevrons drawing in one after the other. */
export function Mark({ size, at = 0 }: { size: number; at?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const front = progress(frame, at, 34, Easing.inOut(Easing.cubic));
  const back = progress(frame, at + 12, 34, Easing.inOut(Easing.cubic));
  return (
    <svg width={((size * 22) / 30) * u} height={size * u} viewBox="0 0 22 30" fill="none">
      <path d="M7.72 9.1 16.84 18.24 7.72 27.4" stroke={color.ink} strokeOpacity={0.52} strokeWidth={3.72} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - back} />
      <path d="M14.24 2.56 5.12 11.72 14.24 20.88" stroke={color.ink} strokeWidth={3.72} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - front} />
    </svg>
  );
}

/** A verdict badge: settles in from slightly small and soft, with no bounce. */
export function Chip({ children, at, tone }: { children: ReactNode; at: number; tone: Tone }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const s = frame < at ? 0 : spring({ frame: frame - at, fps, config: { damping: 200, mass: 1.4 } });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14 * u,
        opacity: s,
        transform: `scale(${0.92 + 0.08 * s})`,
        transformOrigin: "left center",
        filter: `blur(${(1 - s) * 8}px)`,
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

/** A soft band of light crossing the frame once, like a reflection off glass. */
export function Sweep({ at, duration = 60 }: { at: number; duration?: number }) {
  const frame = useCurrentFrame();
  const p = progress(frame, at, duration, Easing.inOut(Easing.sin));
  if (p <= 0 || p >= 1) return null;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(105deg, transparent ${p * 140 - 40}%, rgba(255,255,255,0.07) ${p * 140 - 20}%, transparent ${p * 140}%)`,
        pointerEvents: "none",
      }}
    />
  );
}

/** Film grain over everything, re-seeded every other frame so it moves like film instead of sitting like a texture. */
export function Grain() {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 16;
  // Inline SVG rather than a background image, which Remotion can capture before it has painted.
  return (
    <AbsoluteFill style={{ opacity: 0.06, pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
}
