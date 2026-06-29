"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Static stand-in shown during SSR, while the 3D bundle loads, and for
// anyone with `prefers-reduced-motion`. A faceted crystal silhouette with a
// violet core glow: intentional, not a blank box.
function Poster() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      {/* soft violet halo */}
      <div className="absolute h-1/2 w-1/2 rounded-full bg-[#8b5cf6] opacity-25 blur-[80px]" />
      {/* crystal silhouette */}
      <div
        className="relative h-[42%] w-[30%] rotate-3 bg-gradient-to-br from-white/15 via-[#8b5cf6]/25 to-transparent"
        style={{
          clipPath: "polygon(50% 0%, 100% 32%, 78% 100%, 22% 100%, 0% 32%)",
          boxShadow: "inset 0 0 40px rgba(196,181,253,0.4)",
        }}
      />
    </div>
  );
}

const Scene = dynamic(() => import("./hero-monolith-scene"), {
  ssr: false,
  loading: () => <Poster />,
});

export function HeroMonolith() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setEnabled(!reduce);
  }, []);

  return (
    <div className="relative aspect-square w-full select-none [contain:layout_paint] [mask-image:radial-gradient(ellipse_78%_78%_at_50%_50%,#000_60%,transparent_92%)]">
      {enabled ? <Scene /> : <Poster />}
    </div>
  );
}
