"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Static stand-in for SSR, while the GL bundle loads, for prefers-reduced-motion,
// and for GPUs that can't run the sim. The particle field is pure motion, so its
// absence shouldn't read as "broken" — give the hero a designed, motionless
// backdrop (soft top glow + a faint masked dot field) instead of a black void.
function Fallback() {
  return (
    <div className="absolute inset-0 bg-black">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_38%,#000,transparent_75%)]" />
    </div>
  );
}

const GL = dynamic(() => import("@/components/gl"), {
  ssr: false,
  loading: () => <Fallback />,
});

// The field is a GPGPU sim that renders into a half-float FBO and does vertex
// texture fetch. Some GPUs/drivers (older Windows/ANGLE configs, locked-down
// browsers) can't do that; detect up front so we show the static black
// background instead of an empty/broken canvas.
function supportsGpgpuParticles(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    // RGBA16F must be color-renderable to run the simulation pass…
    const colorRenderable =
      !!gl.getExtension("EXT_color_buffer_half_float") ||
      !!gl.getExtension("EXT_color_buffer_float");
    // …and the point shader samples positions in the vertex stage (VTF).
    const vtf = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return colorRenderable && vtf;
  } catch {
    return false;
  }
}

export function HeroParticles() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Intentional: one-time, post-mount feature/preference detection (window is
    // unavailable during SSR), so a single setState here is the correct pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(!reduce && supportsGpgpuParticles());
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-black"
    >
      {enabled ? <GL /> : <Fallback />}
      {/* Exposure gradient: crushes the field to near-black on the left, opens
          it up toward the right — reads like the scene is lit from the side. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black from-5% via-black/55 via-55% to-transparent" />
    </div>
  );
}
