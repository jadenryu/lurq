import type { ReactNode } from "react";

/**
 * The dark room. This route group holds only `/`, so the surface stops here —
 * the dashboard and the auth pages share the root layout and are untouched.
 *
 * Background is flat `--ground` for the whole route. Sections that want the
 * thin content-column rules opt into `room-rules`. Atmosphere comes from
 * product chrome (panels), not a decorated field behind the page.
 *
 * `isolate` keeps any future blend modes from escaping this subtree.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-surface="room"
      className="relative isolate flex min-h-svh flex-col bg-ground text-ink"
    >
      {children}
    </div>
  );
}
