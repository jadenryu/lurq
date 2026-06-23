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

export function HeroParticles() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setEnabled(!reduce);
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
