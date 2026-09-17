import { SignUp } from "@clerk/nextjs";
import { AuthHeading } from "@/components/auth/auth-shell";
import { AuthPending } from "@/components/auth/auth-motion";
import { AuthNotice } from "@/components/auth/auth-notice";
import { borderlessAppearance } from "@/components/auth/clerk-appearance";

export default function SignUpPage() {
  return (
    <>
      <AuthHeading
        eyebrow="Get started"
        title="Create your lurq account"
        subtitle="Sign up to generate your API key and connect your coding agent."
      />
      <div className="mt-8 w-full">
        <AuthPending>
          {/* Fallback, not force — see the note in /sign-in. A `redirect_url` on
              the way in has to survive, or the scan report's ask converts and then
              strands them. */}
          <SignUp
            fallbackRedirectUrl="/dashboard"
            signInFallbackRedirectUrl="/dashboard"
            signInUrl="/sign-in"
            appearance={borderlessAppearance}
          />
        </AuthPending>
      </div>
      <AuthNotice mode="sign-up" />
    </>
  );
}
