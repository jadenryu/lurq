// Next.js 16 renamed `middleware.ts` → `proxy.ts`. Clerk needs this to run on
// every request so the client SDK can hydrate auth state — without it,
// <SignInButton>/<SignUpButton> and useAuth() silently do nothing.
// No route protection here: this is a marketing site; clerkMiddleware() with no
// matcher logic just establishes the Clerk context. Add createRouteMatcher +
// auth.protect() here if /dashboard should be gated server-side.
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
