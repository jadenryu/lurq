import { createContext, Fragment, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MONO, SANS, WORDMARK } from "./brand";
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

/** A long, soft ease-out: things arrive and then take their time settling. */
const EASE = Easing.bezier(0.25, 1, 0.5, 1);

/** 0 → 1 over `duration` frames starting at `start`, eased and clamped. */
export function progress(frame: number, start: number, duration = 36, easing = EASE): number {
  return interpolate(frame, [start, start + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

/** Set by Video.tsx around each scene, so its words can hold until the picture changes. */
export const SceneTiming = createContext({ frames: 0, cut: 0, last: true });

/** 0 while the scene holds, easing to 1 across the transition into the next one. */
function useExit(): number {
  const frame = useCurrentFrame();
  const { frames, cut, last } = useContext(SceneTiming);
  return last ? 0 : progress(frame, frames - cut - 8, cut + 8, Easing.inOut(Easing.quad));
}

/** The site's dark ground with its two blooms, drifting so a held frame never looks frozen. */
export function Ground() {
  const frame = useCurrentFrame();
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
 * Footage as mood, not as subject: slowed down, pushed in slowly, and put under one cool
 * grade so every clip reads as the same film instead of three stock shots. The grade is a
 * blend layer (composited), not a CSS filter (repainted every frame).
 */
export function Clip({ name, shade = 0.5, focus = "center", zoom = 1, origin = "50% 50%", rate = 0.7 }: { name: string; shade?: number; focus?: string; zoom?: number; origin?: string; rate?: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: color.ground, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${(1.06 + frame * 0.0003) * zoom})`, transformOrigin: origin }}>
        <OffthreadVideo muted playbackRate={rate} src={staticFile(`clips/${name}.mp4`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focus }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "#16203a", mixBlendMode: "color", opacity: 0.4 }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 42%, rgba(8,8,10,${shade * 0.25}) 0%, rgba(8,8,10,${shade}) 72%, rgba(8,8,10,${Math.min(0.95, shade + 0.35)}) 100%)` }} />
    </AbsoluteFill>
  );
}

/** The content layer: a slow upward drift while it holds, then a fade across the transition. */
export function Frame({ children, justify = "flex-end", align = "flex-start", style }: { children: ReactNode; justify?: CSSProperties["justifyContent"]; align?: CSSProperties["alignItems"]; style?: CSSProperties }) {
  const frame = useCurrentFrame();
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

/** A super: words arrive one at a time, rising out of a soft blur, and then hold. */
export function Words({ text, at, size, weight = 600, tone = "ink", stagger = 7, style }: { text: string; at: number; size: number; weight?: number; tone?: Tone; stagger?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  return (
    <div style={{ fontFamily: SANS, fontWeight: weight, fontSize: size * u, lineHeight: 1.06, letterSpacing: "-0.04em", color: color[tone], textWrap: "balance", ...style }}>
      {text.split(" ").map((word, i) => {
        const p = progress(frame, at + i * stagger, 40);
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            <span style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 0.3}em)`, filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined }}>{word}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The source of a claim, small along the bottom edge, as ads footnote one. */
export function Footnote({ children, at }: { children: ReactNode; at: number }) {
  const frame = useCurrentFrame();
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
  const front = progress(frame, at, 40, Easing.inOut(Easing.cubic));
  const back = progress(frame, at + 14, 40, Easing.inOut(Easing.cubic));
  return (
    <svg width={((size * 22) / 30) * u} height={size * u} viewBox="0 0 22 30" fill="none">
      <path d="M7.72 9.1 16.84 18.24 7.72 27.4" stroke={color.ink} strokeOpacity={0.52} strokeWidth={3.72} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - back} />
      <path d="M14.24 2.56 5.12 11.72 14.24 20.88" stroke={color.ink} strokeWidth={3.72} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - front} />
    </svg>
  );
}

/** A verdict badge: settles in from slightly small, with no bounce. */
export function Chip({ children, at, tone }: { children: ReactNode; at: number; tone: Tone }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const s = frame < at ? 0 : spring({ frame: frame - at, fps, config: { damping: 200, mass: 1.4 } });
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

/** A soft band of light crossing the frame once, like a reflection off glass. */
export function Sweep({ at, duration = 60 }: { at: number; duration?: number }) {
  const frame = useCurrentFrame();
  const p = progress(frame, at, duration, Easing.inOut(Easing.sin));
  if (p <= 0 || p >= 1) return null;
  return <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${p * 140 - 40}%, rgba(255,255,255,0.07) ${p * 140 - 20}%, transparent ${p * 140}%)` }} />;
}

/**
 * The product shot: a glass panel that rises and tilts back flat as it settles, with a
 * soft glow under it. One continuous move, no drift afterwards, so nothing feels jittery.
 * `agent` titles it as the coding agent's terminal instead of lurq's.
 */
export function ProductCard({ at, label, agent = false, children }: { at: number; label: string; agent?: boolean; children: ReactNode }) {
  const frame = useCurrentFrame();
  const u = useUnit();
  const square = useSquare();
  const p = progress(frame, at, 70, Easing.bezier(0.16, 1, 0.3, 1));
  return (
    <div style={{ position: "relative", perspective: 2400 * u }}>
      <div style={{ position: "absolute", inset: `${-80 * u}px`, background: `radial-gradient(ellipse at 50% 60%, ${agent ? "rgba(255,255,255,0.05)" : color.bloomTo}, transparent 65%)`, opacity: p }} />
      <div
        style={{
          position: "relative",
          width: (square ? 940 : 1180) * u,
          opacity: p,
          transform: `translateY(${(1 - p) * 60 * u}px) rotateX(${(1 - p) * 14}deg) scale(${0.96 + 0.04 * p})`,
          transformOrigin: "50% 100%",
          background: "linear-gradient(180deg, rgba(30,30,34,0.96) 0%, rgba(14,14,17,0.98) 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderTopColor: "rgba(255,255,255,0.2)",
          borderRadius: 28 * u,
          boxShadow: `0 ${50 * u}px ${140 * u}px rgba(0,0,0,0.55)`,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${22 * u}px ${36 * u}px`, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          {agent ? (
            <span style={{ fontFamily: MONO, fontSize: 22 * u, color: color.ink2 }}>coding agent</span>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12 * u }}>
              <Mark size={24} at={-100} />
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22 * u, color: color.ink }}>{WORDMARK}</span>
            </div>
          )}
          <span style={{ fontFamily: MONO, fontSize: 20 * u, letterSpacing: "0.12em", textTransform: "uppercase", color: color.ink3 }}>{label}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 * u, padding: `${40 * u}px ${44 * u}px ${48 * u}px` }}>{children}</div>
      </div>
    </div>
  );
}

/** A line of terminal input typing out at a human pace, with a blinking caret while it types. */
export function Typed({ text, at, size, until }: { text: string; at: number; size: number; until: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useUnit();
  const shown = text.slice(0, Math.max(0, Math.floor(((frame - at) / fps) * 28)));
  const caret = frame < until && Math.floor(frame / 14) % 2 === 0;
  return (
    <div style={{ fontFamily: MONO, fontSize: size * u, color: color.ink, whiteSpace: "nowrap" }}>
      <span style={{ color: color.ink3 }}>$ </span>
      {shown}
      <span style={{ opacity: caret ? 1 : 0, color: color.ink2 }}>▍</span>
    </div>
  );
}
