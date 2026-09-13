// Next.js 16 renamed `middleware.ts` → `proxy.ts`. Clerk needs this to run on
// every request so the client SDK can hydrate auth state, without it,
// <SignInButton>/<SignUpButton> and useAuth() silently do nothing.
//
// There must be exactly ONE proxy file. Next 16 accepts it at `/proxy.ts` OR
// `/src/proxy.ts` (PROXY_LOCATION_REGEXP = `(?:src/)?proxy`); having both is
// ambiguous and the proxy may not run at all. Since `app` lives in `src/app`,
// this is the canonical spot: do not re-add a root-level proxy.ts.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Default-public; protect by exception. Only the dashboard requires auth, and
// one page of it does not: the builder report is where the landing page's scan
// box sends a visitor who has no account yet. This is the ONLY gate for every
// other dashboard route — the layout renders a locked nav, it does not redirect.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);
const isOpenReport = createRouteMatcher(["/dashboard/report"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req) && !isOpenReport(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals, the /docs multi-zone, the /ingest PostHog proxy, and all static files, unless found in search params
    "/((?!_next|docs|ingest|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
