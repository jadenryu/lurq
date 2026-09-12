import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotice } from "@/components/auth/auth-notice";
import { borderlessAppearance } from "@/components/auth/clerk-appearance";

export default function SignInPage() {
  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back. Sign in to pick up where you left off."
    >
      {/* FALLBACK, NOT FORCE. `forceRedirectUrl` takes precedence over
          everything including the `redirect_url` search param, which is how
          /scan/[owner]/[repo] sends a visitor here and gets them back to the
          report they were reading. Forcing /dashboard dropped them into an
          empty dashboard instead — they paid with an account and the thing
          they paid for was not on the other side. The fallback still sends
          everyone with no destination of their own to /dashboard. */}
      <SignIn
        fallbackRedirectUrl="/dashboard"
        signUpFallbackRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={borderlessAppearance}
      />
      <AuthNotice mode="sign-in" />
    </AuthShell>
  );
}
