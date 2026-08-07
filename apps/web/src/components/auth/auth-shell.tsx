import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/common/logo";
import { GradientBlob } from "@/components/site/gradient-blob";
import { HEADLINE_LINE_1, HEADLINE_LINE_2 } from "@/content/copy";

/**
 * Split auth layout: the brand panel on the left, the form column on the right.
 *
 * THE LEFT PANEL USED TO BE A PHOTOGRAPH. A 1466x2200 mountain range at
 * brightness .4 under a three-stop black gradient, with the mark and a tagline
 * over it. It was the only surface in the product still built that way, and once
 * the marketing page moved to the gradient field it read as a different company's
 * login page.
 *
 * Now it is the hero's own background: the same GradientBlob component at the
 * same opacity, on --ground, with the same two-line headline the home page
 * leads with. One theme, and the panel costs no image bytes at all.
 *
 * The tagline went with the photo. It read "Execution-verified answers for your
 * coding agent", which was a third distinct pitch after the hero's and the
 * footer's, and it made a verification claim the marketing page is careful not
 * to make.
 */
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
      <div className="relative hidden items-center justify-center overflow-hidden bg-ground lg:flex">
        {/* The hero's two blooms, placed for a half-width tall panel rather than
            a full-bleed section: one off the top edge, one off the bottom, both
            pulled to the panel's own centre line. */}
        <GradientBlob
          outer="inset-x-0 -top-40 min-h-screen"
          inner="left-[calc(50%-8rem)] min-h-screen rotate-[30deg]"
        />
        <GradientBlob
          outer="inset-x-0 top-[calc(100%-20rem)] min-h-screen"
          inner="left-[calc(50%+6rem)] min-h-screen"
        />

        <div className="relative z-10 flex flex-col items-center gap-7 px-10 text-center">
          <Image
            src="/logos/lq.png"
            alt="lurq"
            width={96}
            height={96}
            priority
            className="h-16 w-16 object-contain"
          />
          {/* The home page headline, broken on the same two lines, at the same
              weight and tracking. Not a second pitch written for this route. */}
          <h2
            className="max-w-[22ch] font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.75rem, 2.6vw, 2.4rem)",
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
            }}
          >
            <span className="block">{HEADLINE_LINE_1}</span>
            <span className="block">{HEADLINE_LINE_2}</span>
          </h2>
        </div>
      </div>

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
              <h1 className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight sm:text-3xl">
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
    </div>
  );
}
