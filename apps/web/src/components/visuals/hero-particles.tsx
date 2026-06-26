"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Plain black stand-in for SSR, while the GL bundle loads, and for
// prefers-reduced-motion (the particle field is purely motion).
function Fallback() {
  return <div className="absolute inset-0 bg-black" />;
}

const GL = dynamic(() => import("@/components/gl"), {
  ssr: false,
  loading: () => <Fallback />,
});

// The field is a GPGPU sim that renders into a half-float FBO and does vertex
// texture fetch. Some GPUs/drivers (older Windows/ANGLE configs, locked-down
// browsers) can't do that — detect up front so we show the static black
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
    setEnabled(!reduce && supportsGpgpuParticles());
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-black"
    >
      {enabled ? <GL /> : <Fallback />}
    </div>
  );
}
