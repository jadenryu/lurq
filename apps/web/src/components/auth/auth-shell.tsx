import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/common/logo";

// Two-column auth layout adapted from shadcn's `login-02` block: the auth
// element (Clerk) sits on the left; the right panel shows the lurq logo.
// Optional eyebrow/title/subtitle frame the form (e.g. for the demo flow).
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
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center">
          {(eyebrow || title || subtitle) && (
            <div className="mb-6 w-full max-w-sm text-center lg:text-left">
              {eyebrow && (
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {eyebrow}
                </span>
              )}
              {title && (
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
      <div className="relative hidden items-center justify-center overflow-hidden bg-black lg:flex">
        <Image
          src="/logos/larp.jpg"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover object-center brightness-[0.4]"
        />
        {/* darken further toward the edges so overlaid text stays legible */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/50" />
        <div className="relative z-10 flex flex-col items-center gap-4 px-8 text-center">
          <Image
            src="/logos/lq.png"
            alt="lurq"
            width={72}
            height={72}
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
