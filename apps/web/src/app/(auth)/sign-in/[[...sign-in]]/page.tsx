import { SignIn } from "@clerk/nextjs";
import { AuthHeading } from "@/components/auth/auth-shell";
import { AuthPending } from "@/components/auth/auth-motion";
import { AuthNotice } from "@/components/auth/auth-notice";
import { borderlessAppearance } from "@/components/auth/clerk-appearance";

export default function SignInPage() {
  return (
    <>
      <AuthHeading title="Log in" subtitle="Welcome back. Sign in to pick up where you left off." />
      <div className="mt-8 w-full">
        <AuthPending>
          {/* FALLBACK, NOT FORCE. `forceRedirectUrl` takes precedence over
              everything including the `redirect_url` search param, which is how
              a gated page sends a visitor here and gets them back to what they
              were reading. Forcing /dashboard dropped them into an
              empty dashboard instead — they paid with an account and the thing
              they paid for was not on the other side. The fallback still sends
              everyone with no destination of their own to /dashboard. */}
          <SignIn
            fallbackRedirectUrl="/dashboard"
            signUpFallbackRedirectUrl="/dashboard"
            signUpUrl="/sign-up"
            appearance={borderlessAppearance}
          />
        </AuthPending>
      </div>
      <AuthNotice mode="sign-in" />
    </>
  );
}
