import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { color, MONO, SANS } from "./brand";

/** Height-relative unit: 1 at 1080px tall, so wide and square share one scale. */
export function useUnit(): number {
  return useVideoConfig().height / 1080;
}

/** 0 → 1 over `duration` frames starting at `start`, eased and clamped. */
export function progress(frame: number, start: number, duration = 12): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Fade and rise in from `start`. */
export function enter(frame: number, start: number, distance = 14): CSSProperties {
  const p = progress(frame, start);
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` };
}

/** The leading characters of `text` typed by `frame`, at `perSecond` characters a second. */
export function typed(text: string, frame: number, start: number, fps: number, perSecond = 32): string {
  const count = Math.floor(((frame - start) / fps) * perSecond);
  return text.slice(0, Math.max(0, Math.min(text.length, count)));
}

/** The site's ground with its two blooms, drifting slowly so a still frame never reads as a slide. */
export function Background() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 4;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: color.ground,
        backgroundImage: `radial-gradient(circle at ${18 + drift}% ${14 - drift}%, ${color.bloomFrom}, transparent 55%), radial-gradient(circle at ${84 - drift}% ${88 + drift}%, ${color.bloomTo}, transparent 55%)`,
      }}
    />
  );
}

export type Line = { text: string; tone?: "ink" | "ink2" | "ink3" | "bad" | "warn" | "good"; bold?: boolean };

/**
 * A terminal window whose lines appear on their own frames. The font size follows
 * the window width, so the longest real output line (70 characters) fits in both
 * the wide and the square cut without wrapping.
 */
export function Terminal({ title, lines, typedLine }: { title: string; lines: { at: number; line: Line }[]; typedLine?: ReactNode }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const u = useUnit();
  const windowWidth = Math.min(width - 160 * u, 1500 * u);
  const fontSize = windowWidth / 48;
  return (
    <div
      style={{
        width: windowWidth,
        background: color.surface,
        border: `1px solid ${color.edge}`,
        borderTopColor: color.edgeLit,
        borderRadius: 18 * u,
        boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 * u, padding: `${16 * u}px ${22 * u}px`, background: color.surface2, borderBottom: `1px solid ${color.edge}` }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 13 * u, height: 13 * u, borderRadius: 99, background: c, opacity: 0.85 }} />
        ))}
        <div style={{ marginLeft: 12 * u, fontFamily: SANS, fontSize: 20 * u, color: color.ink3 }}>{title}</div>
      </div>
      <div style={{ padding: `${30 * u}px ${40 * u}px`, fontFamily: MONO, fontSize, lineHeight: 1.6, minHeight: fontSize * 1.6 * 7, whiteSpace: "pre" }}>
        {lines.map(({ at, line }, i) =>
          frame >= at ? (
            <div key={i} style={{ ...enter(frame, at, 6), color: color[line.tone ?? "ink"], fontWeight: line.bold ? 700 : 400 }}>
              {line.text || " "}
            </div>
          ) : null,
        )}
        {typedLine}
      </div>
    </div>
  );
}

/** A caption under the action, springing in: the line a sound-off viewer reads. */
export function Caption({ children, at }: { children: ReactNode; at: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = useUnit();
  const square = width / height < 1.2;
  const s = spring({ frame: frame - at, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        opacity: frame >= at ? s : 0,
        transform: `translateY(${(1 - s) * 18 * u}px)`,
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: (square ? 50 : 58) * u,
        letterSpacing: "-0.03em",
        color: color.ink,
        textAlign: "center",
        textWrap: "balance",
        maxWidth: width - 120 * u,
      }}
    >
      {children}
    </div>
  );
}

export function Stack({ children, gap = 56 }: { children: ReactNode; gap?: number }) {
  const u = useUnit();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: gap * u }}>
      {children}
    </AbsoluteFill>
  );
}
