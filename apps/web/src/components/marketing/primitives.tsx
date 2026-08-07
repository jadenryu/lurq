import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/marketing-data";

/**
 * Layout primitives for the marketing page.
 *
 * One centred container at 1080px, one deliberate exception at 1280px for the
 * graph, and sections separated by a hairline rule rather than by whitespace
 * alone. Vertical rhythm comes from a fixed scale (4/8/12/16/24/32/48/64/96/128)
 * — nothing in between.
 */

export function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1080px] px-6", className)}>
      {children}
    </div>
  );
}

/** The graph, and only the graph, exceeds the container. */
export function Breakout({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1280px] px-6", className)}>
      {children}
    </div>
  );
}

/**
 * The small uppercase label above a section. A section eyebrow, not a figure
 * number — `FIG n` is paper furniture and this is a product.
 */
export function Label({ children }: { children: ReactNode }) {
  return <p className="t-label mb-5">{children}</p>;
}

/** Body copy, capped at 68ch. Prose is never full-width and never centred. */
export function Body({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <p className={cn("t-body text-ink-soft", className)}>{children}</p>;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  declared: "declared",
  conflict: "conflict",
  verified: "verified",
};

const VERDICT_CLASS: Record<"paper" | "dark", Record<Verdict, string>> = {
  paper: {
    declared: "text-declared border-declared/40",
    conflict: "text-conflict border-conflict/50",
    verified: "text-verified border-verified/50",
  },
  dark: {
    declared: "text-declared-lift border-declared-lift/40",
    conflict: "text-conflict-lift border-conflict-lift/50",
    verified: "text-verified-lift border-verified-lift/50",
  },
};

const VERDICT_DOT: Record<"paper" | "dark", Record<Verdict, string>> = {
  paper: { declared: "bg-declared", conflict: "bg-conflict", verified: "bg-verified" },
  dark: {
    declared: "bg-declared-lift",
    conflict: "bg-conflict-lift",
    verified: "bg-verified-lift",
  },
};

/**
 * The verdict colours appear here, in the graph, in the diff markers, and nowhere
 * else. Always a word alongside the colour, never colour alone.
 */
export function VerdictBadge({
  verdict,
  label,
  tone = "paper",
  className,
}: {
  verdict: Verdict;
  label?: string;
  tone?: "paper" | "dark";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "t-label inline-flex items-center gap-1.5 rounded border px-1.5 py-1",
        VERDICT_CLASS[tone][verdict],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("inline-block size-1.5 rounded-full", VERDICT_DOT[tone][verdict])}
      />
      {label ?? VERDICT_LABEL[verdict]}
    </span>
  );
}

/**
 * A dark panel on the paper — the surface every real artifact sits on. 8px
 * radius, one soft shadow to seat it, no glow and no blur.
 */
export function Viewport({
  className,
  label,
  children,
}: {
  className?: string;
  /** Optional monospace caption inside the panel's top edge. */
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("instrument overflow-hidden", className)}>
      {label ? (
        <div className="t-label flex items-center gap-2 border-b border-viewport-3 px-4 py-3 text-viewport-ink/55">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * A feature block: text on one side, the artifact on the other, alternating down
 * the page. Each one leads with the problem, not the feature.
 */
export function ChessBlock({
  label,
  heading,
  body,
  footnote,
  artifact,
  flip = false,
  id,
}: {
  label: string;
  heading: string;
  body: ReactNode;
  footnote: string;
  artifact: ReactNode;
  /** Artifact left, text right. */
  flip?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-rule py-16 md:py-28">
      <Container>
        <Label>{label}</Label>
        <div className="grid gap-8 md:gap-10 lg:grid-cols-12">
          <div
            className={cn(
              "lg:col-span-5",
              flip ? "lg:order-2 lg:col-start-8" : "lg:col-start-1",
            )}
          >
            <h2 className="t-h2 max-w-[26ch] text-balance text-ink">{heading}</h2>
            <div className="mt-5 space-y-4">{body}</div>
            <p className="t-data mt-6 text-ink-soft">{footnote}</p>
          </div>
          <div
            className={cn(
              "min-w-0 lg:col-span-6",
              flip ? "lg:order-1 lg:col-start-1" : "lg:col-start-7",
            )}
          >
            {artifact}
          </div>
        </div>
      </Container>
    </section>
  );
}

/** Rendered when an artifact file is absent. An obviously empty section is
 *  fixable; a section full of invented results is not. */
export function EmptyArtifact({ what }: { what: string }) {
  return (
    <Viewport className="flex min-h-[220px] items-center justify-center px-6 py-12">
      <p className="t-data max-w-[36ch] text-center text-viewport-ink/45">
        no {what} recorded yet. this panel stays empty until there is a real one.
      </p>
    </Viewport>
  );
}
