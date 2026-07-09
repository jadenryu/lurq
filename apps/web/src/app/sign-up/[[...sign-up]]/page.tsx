import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your lurq account"
      subtitle="Sign up to generate your API key and connect your coding agent."
    >
      <SignUp forceRedirectUrl="/dashboard" signInUrl="/sign-in" />
    </AuthShell>
  );
}
