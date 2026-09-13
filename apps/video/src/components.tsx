import { Fragment, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MONO, SANS } from "./brand";
import type { IconNode } from "./icons";

type Tone = "ink" | "ink2" | "ink3" | "bad" | "warn" | "good";

/** Height-relative unit: 1 at 1080px tall, so wide and square share one scale. */
export function useUnit(): number {
  return useVideoConfig().height / 1080;
}

export function useSquare(): boolean {
  const { width, height } = useVideoConfig();
  return width / height < 1.2;
}

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 → 1 over `duration` frames starting at `start`, eased out and clamped. */
export function progress(frame: number, start: number, duration = 14): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
}

/** The site's ground with its two blooms, drifting slowly so a still frame never reads as a slide. */
export function Background() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 60) * 5;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: color.ground,
        backgroundImage: `radial-gradient(circle at ${18 + drift}% ${14 - drift}%, ${color.bloomFrom}, transparent 55%), radial-gradient(circle at ${84 - drift}% ${88 + drift}%, ${color.bloomTo}, transparent 55%)`,
      }}
    />
  );
}

/** Stock footage, full bleed: a slow push-in, darkened toward the bottom where the words sit. */
export function Clip({ name, dim = 0.6, focus = "center" }: { name: string; dim?: number; focus?: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${1.04 + frame * 0.0008})` }}>
        <OffthreadVideo muted src={staticFile(`clips/${name}.mp4`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focus }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(8,8,10,${dim * 0.6}) 0%, rgba(8,8,10,${dim}) 55%, rgba(8,8,10,${Math.min(1, dim + 0.3)}) 100%)`,
          boxShadow: "inset 0 0 260px rgba(0,0,0,0.75)",
        }}
      />
    </AbsoluteFill>
  );
}

/** Footage in a panel that wipes open from one edge. */
export function ClipPanel({ name, at = 0, from = "left", dim = 0.25 }: { name: string; at?: number; from?: "left" | "right" | "top"; dim?: number }) {
  const frame = useCurrentFrame();
  const hidden = (1 - progress(frame, at, 22)) * 100;
  const inset = from === "left" ? `0 ${hidden}% 0 0` : from === "right" ? `0 0 0 ${hidden}%` : `0 0 ${hidden}% 0`;
  return (
    <div style={{ position: "relative", flex: 1, overflow: "hidden", clipPath: `inset(${inset})` }}>
      <Clip name={name} dim={dim} />
    </div>
  );
}

/** The content layer: padded, stacked, left-aligned like a documentary lower third. */
export function Frame({ children, justify = "center", style }: { children: ReactNode; justify?: CSSProperties["justifyContent"]; style?: CSSProperties }) {
  const u = useUnit();
  const square = useSquare();
  return (
    <AbsoluteFill style={{ flexDirection: "column", justifyContent: justify, padding: `${(square ? 80 : 110) * u}px ${(square ? 72 : 130) * u}px`, ...style }}>
      {children}
    </AbsoluteFill>
  );
}

/** A caption that arrives one word at a time, each word lifting out of a blur. */
export function Words({ text, at, size, weight = 600, tone = "ink", stagger = 3, style }: { text: string; at: number; size: number; weight?: number; tone?: Tone; stagger?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  return (
    <div style={{ fontFamily: SANS, fontWeight: weight, fontSize: size * u, lineHeight: 1.06, letterSpacing: "-0.035em", color: color[tone], textWrap: "balance", ...style }}>
      {text.split(" ").map((word, i) => {
        const p = progress(frame, at + i * stagger, 12);
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            <span style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 0.28}em)`, filter: `blur(${(1 - p) * 10}px)` }}>{word}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** A number that counts up to `to`, eased so it settles rather than stops. */
export function Counter({ to, at, size, suffix = "", decimals = 0, tone = "ink", duration = 32 }: { to: number; at: number; size: number; suffix?: string; decimals?: number; tone?: Tone; duration?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const value = interpolate(frame, [at, at + duration], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ opacity: progress(frame, at, 8), fontFamily: SANS, fontWeight: 600, fontSize: size * u, lineHeight: 0.9, letterSpacing: "-0.055em", color: color[tone], fontVariantNumeric: "tabular-nums" }}>
      {value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </div>
  );
}

/** A chapter label: index, a rule that draws itself, the name. */
export function Kicker({ index, label, at = 0 }: { index: string; label: string; at?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, at, 16);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 * u, fontFamily: MONO, fontSize: 22 * u, letterSpacing: "0.14em", textTransform: "uppercase", color: color.ink3, opacity: p }}>
      <span style={{ color: color.ink }}>{index}</span>
      <span style={{ width: 56 * u * p, height: 1, background: color.edgeLit }} />
      <span>{label}</span>
    </div>
  );
}

/** Where a number came from, pinned to the bottom edge. */
export function Source({ children, at }: { children: ReactNode; at: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  return (
    <div style={{ position: "absolute", left: (square ? 72 : 130) * u, bottom: (square ? 44 : 60) * u, opacity: progress(frame, at, 14) * 0.9, fontFamily: MONO, fontSize: 18 * u, letterSpacing: "0.1em", textTransform: "uppercase", color: color.ink3 }}>
      Source · {children}
    </div>
  );
}

/** A horizontal bar filling to `value` percent. */
export function Bar({ value, at, tone = "ink", style }: { value: number; at: number; tone?: Tone; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, at, 34);
  return (
    <div style={{ height: 6 * u, background: color.edge, borderRadius: 99, overflow: "hidden", ...style }}>
      <div style={{ width: `${value * p}%`, height: "100%", background: color[tone], borderRadius: 99 }} />
    </div>
  );
}

/** Dots lighting up in a scattered, repeatable order: a count you can see. */
export function DotMatrix({ at, cols, rows, tone = "bad", duration = 40 }: { at: number; cols: number; rows: number; tone?: Tone; duration?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const n = cols * rows;
  const lit = progress(frame, at, duration) * n;
  const gap = 26 * u;
  return (
    <svg width={cols * gap} height={rows * gap}>
      {Array.from({ length: n }, (_, i) => {
        const on = (i * 7919) % n < lit;
        return <circle key={i} cx={(i % cols) * gap + gap / 2} cy={Math.floor(i / cols) * gap + gap / 2} r={on ? 5 * u : 2.4 * u} fill={on ? color[tone] : color.edgeLit} />;
      })}
    </svg>
  );
}

/** A Lucide icon that draws its strokes in. */
export function Icon({ node, at, size, tone = "ink", strokeWidth = 1.5 }: { node: IconNode; at: number; size: number; tone?: Tone; strokeWidth?: number }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const p = progress(frame, at, 24);
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
  const front = progress(frame, at, 16);
  const back = progress(frame, at + 6, 16);
  return (
    <svg width={((size * 22) / 30) * u} height={size * u} viewBox="0 0 22 30" fill="none">
      <path d="M7.72 9.1 16.84 18.24 7.72 27.4" stroke={color.ink} strokeOpacity={0.52} strokeWidth={3.72} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - back} />
      <path d="M14.24 2.56 5.12 11.72 14.24 20.88" stroke={color.ink} strokeWidth={3.72} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - front} />
    </svg>
  );
}

/** A verdict stamp: springs in slightly oversized and settles. */
export function Chip({ children, at, tone }: { children: ReactNode; at: number; tone: Tone }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 180 } });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14 * u,
        opacity: frame >= at ? Math.min(1, s) : 0,
        transform: `scale(${0.8 + 0.2 * s})`,
        transformOrigin: "left center",
        padding: `${12 * u}px ${24 * u}px`,
        borderRadius: 999,
        border: `1px solid ${color[tone]}66`,
        background: `${color[tone]}1f`,
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
