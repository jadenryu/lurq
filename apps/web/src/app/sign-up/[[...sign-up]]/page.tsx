import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotice } from "@/components/auth/auth-notice";
import { borderlessAppearance } from "@/components/auth/clerk-appearance";

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your lurq account"
      subtitle="Sign up to generate your API key and connect your coding agent."
    >
      {/* Fallback, not force — see the note in /sign-in. A `redirect_url` on
          the way in has to survive, or the scan report's ask converts and then
          strands them. */}
      <SignUp
        fallbackRedirectUrl="/dashboard"
        signInFallbackRedirectUrl="/dashboard"
        signInUrl="/sign-in"
        appearance={borderlessAppearance}
      />
      <AuthNotice mode="sign-up" />
    </AuthShell>
  );
}
