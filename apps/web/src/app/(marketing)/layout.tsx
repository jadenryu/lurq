import type { ReactNode } from "react";

/**
 * The marketing route is the one light surface on the site.
 *
 * `data-surface="paper"` carries the paper/ink token set (see globals.css) and
 * `color-scheme: light`, which also fixes form controls and scrollbars inside it.
 * The root layout stays dark for the dashboard and the auth pages — the two
 * systems never meet on one screen.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="paper" className="flex min-h-svh flex-col">
      {children}
    </div>
  );
}
