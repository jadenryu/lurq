import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/common/logo";
// Static import → Next generates a blurDataURL for an instant placeholder and
// serves an optimized webp (source is a compressed 1466×2200 backdrop).
import larp from "../../../public/logos/larp.jpg";

// Split auth layout (Neon-style): a wide 70% form column on the left with a
// centered, borderless Clerk element, and a narrow 30% photo panel on the
// right carrying the lurq mark + tagline over a low-exposure backdrop.
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
    <div className="grid min-h-svh lg:grid-cols-[7fr_3fr]">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-md text-center">
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
      </div>

      <div className="relative hidden items-center justify-center overflow-hidden bg-black lg:flex">
        <Image
          src={larp}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="30vw"
          className="object-cover object-center brightness-[0.4]"
        />
        {/* darken toward the edges so the overlaid mark + tagline stay legible */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/45" />
        <div className="relative z-10 flex flex-col items-center gap-5 px-8 text-center">
          <Image
            src="/logos/lq.png"
            alt="lurq"
            width={80}
            height={80}
            priority
            className="h-16 w-16 object-contain"
          />
          <p className="max-w-xs text-2xl font-semibold leading-snug tracking-tight text-white">
            Objective package recommendations for your coding agent.
          </p>
        </div>
      </div>
    </div>
  );
}
