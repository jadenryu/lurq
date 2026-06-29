// Hero atmosphere: a neutral grey ambient glow spanning the whole section,
// with a slowly drifting nebula and faint god-rays. Pure CSS (see globals.css)
// so it renders identically on the server: no hydration gap, no blank first
// paint. Animations stop under reduced-motion.
export function HeroAtmosphere() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* full-section grey ambient gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_25%,rgba(255,255,255,0.06),transparent_70%)]" />

      {/* drifting grey nebula across the full width */}
      <div className="nebula-blob nebula-blob-1" />
      <div className="nebula-blob nebula-blob-2" />

      {/* faint god-rays sweeping the whole section, slow rotation */}
      <div className="hero-godrays" />

      {/* fade into the page background at the bottom */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
