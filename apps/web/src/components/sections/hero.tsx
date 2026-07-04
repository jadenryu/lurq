"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/common/container";
import { WaitlistDialog } from "@/components/common/waitlist-dialog";
import { HeroParticles } from "@/components/visuals/hero-particles";
import { VideoPlaceholder } from "@/components/visuals/video-placeholder";

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// eased 0..1 for x mapped from [a,b]
const seg = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));

// Scroll stage driven by a plain scroll listener writing inline styles directly
// (framer's useScroll pipeline silently no-ops under this Next/Turbopack/React
// stack, so we don't route through it). Timeline over the pinned stage:
//   0.05–0.26  headline fades + lifts away as the video climbs (R3F bg stays)
//   0.06–0.48  video rises from below and settles centered on the R3F field
//   0.55–0.85  whole stage (bg + video) fades out into the next section
export function Hero() {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    // Land at the top so the scroll animation always starts fresh — browsers
    // otherwise restore the previous scroll position on reload, dropping the
    // user mid- or post-animation.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    // smoothstep — softens the entry/exit of every phase so nothing snaps
    const ease = (t: number) => t * t * (3 - 2 * t);

    const apply = (p: number) => {
      // video: rise (0.06→0.48), hold, then drift up as the stage fades
      const rise = ease(seg(p, 0.06, 0.5));
      let vy = lerp(800, 0, rise);
      if (p > 0.7) vy = lerp(0, -140, ease(seg(p, 0.7, 1))); // lift-out
      const vs = lerp(0.9, 1, rise);
      // headline: fade + lift, gone by 0.26 (well before the video covers)
      const fade = ease(seg(p, 0.05, 0.26));
      // stage: fade out ending exactly at the section end (1.0), so the marquee
      // hands off the instant the video finishes fading — no trailing black.
      const stage = 1 - ease(seg(p, 0.7, 1));

      if (videoRef.current)
        videoRef.current.style.transform = `translateY(${vy}px) scale(${vs})`;
      if (textRef.current) {
        textRef.current.style.opacity = String(1 - fade);
        textRef.current.style.transform = `translateY(${lerp(0, -60, fade)}px)`;
      }
      if (stageRef.current) stageRef.current.style.opacity = String(stage);
    };

    const readTarget = () => {
      const rect = track.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      return total > 0 ? clamp01(-rect.top / total) : 0;
    };

    // Reduced motion: no scroll animation — just show the video centered.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (videoRef.current) videoRef.current.style.transform = "none";
      return;
    }

    let raf = 0;
    let current = readTarget();
    let target = current;
    let running = false;

    // damping: ease the applied progress toward the real scroll position each
    // frame, so the whole sequence trails the scroll smoothly (buttery, slower-
    // feeling) instead of tracking it 1:1 (harsh). Lower factor = slower trail.
    const render = () => {
      current += (target - current) * 0.09;
      apply(current);
      if (Math.abs(target - current) > 0.0004) {
        raf = requestAnimationFrame(render);
      } else {
        current = target;
        apply(current);
        running = false;
      }
    };
    const kick = () => {
      target = readTarget();
      if (!running) {
        running = true;
        raf = requestAnimationFrame(render);
      }
    };

    apply(current);
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    return () => {
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
      cancelAnimationFrame(raf);
    };
  }, []);

  const headline = (
    <div className="max-w-none">
      <h1 className="font-heading text-5xl font-medium leading-[1.0] tracking-tight sm:text-6xl md:text-7xl lg:text-8xl">
        <span className="block text-muted-foreground lg:whitespace-nowrap">
          Your agent&apos;s package
        </span>
        <span className="block text-muted-foreground lg:whitespace-nowrap">
          knowledge is frozen.
        </span>
        <span className="mt-2 block font-bold text-foreground lg:whitespace-nowrap">
          lurq keeps it current.
        </span>
      </h1>

      <div className="mt-10 flex flex-col items-start gap-x-7 gap-y-4 sm:flex-row sm:items-center">
        <WaitlistDialog />
        <a
          href="#product"
          className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          See how it works
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </a>
      </div>
    </div>
  );

  return (
    <section ref={trackRef} className="relative h-[200vh]">
      <div
        ref={stageRef}
        className="sticky top-0 h-screen overflow-hidden"
      >
        {/* R3F particle field behind the whole stage — the video lands on it */}
        <HeroParticles />

        {/* headline: fades + lifts as the video rises (initial state = visible) */}
        <div className="absolute inset-0 flex items-center px-6 pt-24 pb-[20vh]">
          <Container className="relative" >
            <div ref={textRef}>{headline}</div>
          </Container>
        </div>

        {/* video: starts off-screen below, rises up over the field */}
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div
            ref={videoRef}
            className="w-full max-w-6xl"
            style={{ transform: "translateY(800px) scale(0.9)" }}
          >
            <VideoPlaceholder />
          </div>
        </div>
      </div>
    </section>
  );
}
