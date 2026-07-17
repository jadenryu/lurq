import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/common/logo";
// Static import → Next generates a blurDataURL for an instant placeholder and
// serves an optimized webp (source is a compressed 1466×2200 backdrop).
import larp from "../../../public/logos/larp.jpg";

// Single centered auth column over a near-black, full-bleed photo backdrop.
// The Clerk element (borderless) stacks under an eyebrow/title/subtitle header.
export function AuthShell({
  children,
  eyebrow,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-black px-6 py-16">
      <Image
        src={larp}
        alt=""
        fill
        priority
        placeholder="blur"
        sizes="100vw"
        className="object-cover object-center brightness-[0.25]"
      />
      {/* deepen to near-black so the centered form reads cleanly over the photo */}
      <div className="absolute inset-0 bg-black/55" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <Link href="/" className="mb-8 flex items-center gap-2 font-medium">
          <Logo />
        </Link>
        {eyebrow && (
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </span>
        )}
        {title && (
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>
        )}
        <div className="mt-8 w-full">{children}</div>
      </div>
    </div>
  );
}
