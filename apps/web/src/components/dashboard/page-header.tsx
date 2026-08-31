import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/dashboard/panel";

/**
 * Consistent dashboard page header: title + subtitle on the left, an optional
 * primary action on the right, with a hairline divider beneath.
 *
 * `demo` renders a chip next to the title. It's deliberately always visible when
 * fixtures are in play: fake numbers that look exactly like real ones are worse
 * than no numbers, especially if this branch ever ships.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  demo = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  demo?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-medium lowercase tracking-tight md:text-3xl">
            {title}
          </h1>
          {demo && <Chip tone="warn">demo data</Chip>}
        </div>
        {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The body of a dashboard page: the gap under the header, and the rhythm between
 * the sections below it.
 *
 * Every page was writing this by hand and no two agreed — `mt-8 space-y-6` on
 * most, `mt-8 space-y-4` on the audit log, `mt-10 space-y-14` on the guide, and
 * nothing at all on billing, which left its first panel sitting against the
 * header rule. Vertical rhythm is the thing a reader notices only when it
 * changes, so it belongs to the shell, not to fifteen page files.
 *
 * `prose` is the one real exception rather than a per-page override: the guide is
 * long-form reading where sections want room to separate, not a board of panels
 * meant to be scanned as one screen.
 */
export function PageBody({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "prose";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-8",
        variant === "default" && "space-y-6",
        variant === "prose" && "space-y-14",
        className,
      )}
    >
      {children}
    </div>
  );
}
