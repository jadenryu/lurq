"use client";

import { useEffect, useRef } from "react";

/**
 * The core of the provenance orbit: a rotating point cloud on a 2D canvas.
 *
 * WHY NOT THREE.JS. The 21st.dev block this section is adapted from imported a
 * `ParticleSphereAnimation` that never shipped with the snippet, and every
 * version of that component in the wild is a WebGL scene. That is ~150kB gzipped
 * of renderer, scene graph, camera and material system to draw a thousand dots
 * with no lighting, no texture and no perspective. Canvas 2D is already in the
 * platform and the whole loop below is forty lines.
 *
 * WHY IT LOOKS SPHERICAL. Nothing here is really 3D. Points are placed on a unit
 * sphere, spun about the Y axis and projected flat, and then depth drives two
 * things at once: radius and alpha. Dots on the far side are small and dim, dots
 * on the near side are large and bright, and that alone reads as a solid volume
 * turning. Perspective divide was tried and removed: at this radius it only
 * bows the silhouette.
 *
 * Colour comes from the element's own `color`, so the globe is whatever token
 * the caller sets and cannot drift from the palette.
 */

/**
 * Enough to read as a surface rather than as confetti.
 *
 * 1100 was the first number and it was far too few: spread over a 580px sphere
 * that is half below the fold, it is a scatter of dots with gaps you can see
 * through. Density is most of what sells this: the reference cloud is in the
 * thousands. The draw is a fillRect rather than an arc precisely so this number
 * can be this large; see the loop.
 */
const COUNT = 7000;

/** Radians per frame. At 60fps this is a touch over one turn a minute. */
const SPEED = 0.0018;

/** Axial tilt, so the sphere is seen slightly from above rather than edge-on. */
const TILT = 0.32;
const TILT_COS = Math.cos(TILT);
const TILT_SIN = Math.sin(TILT);

/**
 * Deterministic 0..1 from an index. Not Math.random: the cloud has to be the
 * same on every render, and a hash costs nothing here because it runs once.
 */
function hash(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Fibonacci lattice. A lat/long grid bunches points at the poles, which reads as
 * two bright caps and a sparse equator, the one arrangement that gives the
 * illusion away.
 */
function lattice() {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: COUNT }, (_, i) => {
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = golden * i;
    // Pull each point in off the surface by a random fraction, so the cloud is
    // a shell with thickness rather than a skin. On a perfect sphere at this
    // count the lattice lines up into visible rows and the whole thing reads as
    // a wireframe; scattering the radius is what turns it back into particles.
    const shell = 0.92 + hash(i) * 0.08;
    // Tint index, fixed per point so a dot keeps its colour as the sphere turns
    // rather than strobing. 0 is ink; anything above indexes the caller's
    // palette. The primes give an uneven scatter without a random source, which
    // keeps the cloud stable across renders.
    const tint = i % 4 === 0 ? 1 : i % 7 === 0 ? 2 : i % 17 === 0 ? 3 : i % 23 === 0 ? 4 : 0;
    return {
      x: Math.cos(t) * r * shell,
      y: y * shell,
      z: Math.sin(t) * r * shell,
      tint,
    };
  });
}

/**
 * Hoisted so the default is referentially stable. A `= []` in the signature is a
 * fresh array every render, which puts a new value in the effect's dependency
 * list and rebuilds the lattice and the observer on each one.
 */
const NO_TINTS: readonly string[] = [];

export function ParticleGlobe({
  className,
  tints = NO_TINTS,
}: {
  className?: string;
  /** Accent colours speckled through the cloud. Any CSS colour; the majority of
   *  points always stay the element's own `color`. */
  tints?: readonly string[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const points = lattice();
    let angle = 0;
    let raf = 0;

    // Read once, not per frame. getComputedStyle forces a style recalc, and the
    // element's colour and the palette built from it are both fixed for its
    // lifetime. Index 0 is that colour, and every unmapped tint falls back to
    // it, so a short palette can never index past the end.
    const ink = getComputedStyle(canvas).color;
    const palette = [ink, ...tints.map((t) => t || ink)];

    const draw = () => {
      const size = canvas.clientWidth;
      if (!size) return;
      // Cap DPR at 2. A 3x retina buffer of a thousand arcs costs three times
      // the fill for a difference nobody can see on a 1px dot.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.round(size * dpr);
      // Both dimensions, and both tested. A canvas defaults to 300x150, so at
      // dpr 1 in a 300px box `width` already matches and a width-only guard
      // leaves `height` at 150, and the sphere then draws into a half-height buffer
      // that CSS stretches back to square, which is a dome of vertical dashes.
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const c = size / 2;
      const r = c * 0.94;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Density scales with diameter. The full count is tuned for the desktop
      // sphere; poured into the 240px mobile one the dots overlap into a solid
      // speckled lump.
      //
      // Strided, not sliced. The lattice is generated north pole to south, so
      // the first n entries are a cap rather than a sample. Taking every
      // (len/n)th point is what keeps a thinned cloud a whole sphere.
      const n = Math.min(points.length, Math.round(size * 12));
      const stride = points.length / n;

      for (let k = 0; k < n; k++) {
        const p = points[Math.floor(k * stride)];
        // Spin about Y, then tilt the whole thing toward the viewer. Without the
        // tilt both poles sit exactly on the silhouette and the lattice reads as
        // a flat disc of evenly spaced dots; a few degrees is all it takes to
        // put one pole in view and make the rows curve.
        const x = p.x * cos - p.z * sin;
        const zy = p.x * sin + p.z * cos;
        const y = p.y * TILT_COS - zy * TILT_SIN;
        const z = p.y * TILT_SIN + zy * TILT_COS;

        const depth = (z + 1) / 2; // 0 at the back, 1 at the front
        // Both cues on the same ramp, and a wide one. A narrow alpha range was
        // the other reason this read flat: the far hemisphere has to nearly
        // vanish for the near one to look like it is in front of something.
        // Curved, but not as hard as depth-squared, which crushed everything at
        // the limb to near-nothing. The rim needs to stay lit: on a thin shell
        // it is the densest part of the silhouette and that is what gives the
        // cloud an edge.
        ctx.globalAlpha = 0.08 + depth * (0.25 + depth * 0.62);
        ctx.fillStyle = palette[p.tint] ?? ink;
        // fillRect, not arc. A path per point caps this at about a thousand
        // before frames start slipping; a rect is a single raster op and lets
        // the count go to where the cloud actually looks dense. At a 1-3px dot
        // the difference between a square and a circle is not visible.
        const d = 0.9 + depth * 2.1;
        ctx.fillRect(c + x * r - d / 2, c + y * r - d / 2, d, d);
      }
    };

    /**
     * Paint one frame at mount, before anything else is wired up.
     *
     * This used to be the observer's job and that was the bug: with the first
     * draw deferred until the canvas intersected, the buffer sat at its default
     * 300x150 and the sphere did not exist at all until a frame or two after it
     * came into view. Scroll down at any speed and you arrive at an empty hole
     * where the globe should be.
     *
     * The observer's job is whether the sphere *spins*. Whether it *exists* is
     * not a thing to defer: it costs one frame at mount and it means the globe
     * is already there whenever the reader reaches it.
     */
    draw();

    // Keep it correct through a resize even when it is not animating: `draw`
    // reads clientWidth every call, so this is also what re-sizes the buffer.
    const onResize = () => draw();
    window.addEventListener("resize", onResize);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      // A sphere, held still. The section's content is the ten sources around
      // it, so nothing is lost by the core not turning.
      return () => window.removeEventListener("resize", onResize);
    }

    const tick = () => {
      angle += SPEED;
      draw();
      raf = requestAnimationFrame(tick);
    };

    // Only spin while it is on screen. This is the page's one unbounded
    // animation loop, and a landing page that keeps a canvas busy after the
    // reader has scrolled past it is just draining a battery.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !raf) {
          raf = requestAnimationFrame(tick);
        } else if (!entry.isIntersecting && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    return () => {
      io.disconnect();
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tints]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
