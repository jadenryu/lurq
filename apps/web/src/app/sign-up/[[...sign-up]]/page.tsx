import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Book a demo"
      title="Create an account to book your demo"
      subtitle="Sign up and you'll go straight to scheduling a time with the team."
    >
      <SignUp forceRedirectUrl="/book-demo" signInUrl="/sign-in" />
    </AuthShell>
  );
}
