import type { ReactNode } from "react";

/**
 * Consistent dashboard page header: title + subtitle on the left, an optional
 * primary action on the right, with a hairline divider beneath.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-medium lowercase tracking-tight md:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
