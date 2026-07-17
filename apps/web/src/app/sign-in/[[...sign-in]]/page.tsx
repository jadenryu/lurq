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
      <SignIn
        forceRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={borderlessAppearance}
      />
      <AuthNotice mode="sign-in" />
    </AuthShell>
  );
}
