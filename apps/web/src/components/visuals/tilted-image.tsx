"use client";

import Image from "next/image";

interface TiltedImageProps {
  src: string;
  alt: string;
  /** intrinsic pixel dimensions of the source image (for next/image) */
  width: number;
  height: number;
  /** tweak these to change the angle */
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
}

// A floating, perspective-tilted panel. The earlier defaults stacked three
// large rotations around a top-left origin, which folded the plane until it
// clipped into a triangle. One dominant tilt + a slight turn, around the
// CENTER, reads as a 3D dashboard instead.
export function TiltedImage({
  src,
  alt,
  width,
  height,
  rotateX = 12,
  rotateY = -20,
  rotateZ = 0,
  scale = 1,
}: TiltedImageProps) {
  return (
    // 1. Perspective container – this is what makes it "3D" instead of flat skew
    <div
      style={{
        perspective: "1800px",
        perspectiveOrigin: "50% 50%",
        transformStyle: "preserve-3d",
      }}
      className="relative w-full"
    >
      {/* 2. The transformed element, rotated around its center */}
      <div
        style={{
          transformOrigin: "center",
          backfaceVisibility: "hidden",
          transform: `translateX(88px) scale(${scale}) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`,
          transformStyle: "preserve-3d",
        }}
        className="mx-auto w-[500px] max-w-none overflow-hidden rounded-xl border border-zinc-800 shadow-2xl shadow-black/50"
      >
        {/* 3. Swap this image for any image you want */}
        <Image
          src={src || "/placeholder.svg"}
          alt={alt}
          width={width}
          height={height}
          priority
          sizes="(max-width: 1024px) 0px, 500px"
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}
