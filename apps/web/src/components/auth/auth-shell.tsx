import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/common/logo";
// Static import → Next generates a blurDataURL for an instant placeholder and
// serves an optimized webp instead of the 3.3MB source.
import larp from "../../../public/logos/larp.jpg";

// Two-column auth layout adapted from shadcn's `login-02` block: the auth
// element (Clerk) sits on the left; the right panel is a full-bleed, low-
// exposure photo with the lurq mark + tagline. 30/70 split favors the visual.
// Optional eyebrow/title/subtitle frame the form (freeform — no card).
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
    <div className="grid min-h-svh lg:grid-cols-[3fr_7fr]">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-sm">
            {(eyebrow || title || subtitle) && (
              <div className="mb-6 text-center lg:text-left">
                {eyebrow && (
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {eyebrow}
                  </span>
                )}
                {title && (
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
            )}
            {children}
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
          sizes="70vw"
          className="object-cover object-center brightness-[0.4]"
        />
        {/* darken toward the edges so the overlaid mark + tagline stay legible */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/45" />
        <div className="relative z-10 flex flex-col items-center gap-6 px-10 text-center">
          <Image
            src="/logos/lq.png"
            alt="lurq"
            width={112}
            height={112}
            priority
            className="h-24 w-24 object-contain"
          />
          <p className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-white">
            Objective package recommendations for your coding agent.
          </p>
        </div>
      </div>
    </div>
  );
}
