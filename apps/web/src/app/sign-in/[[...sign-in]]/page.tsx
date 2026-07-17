import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotice } from "@/components/auth/auth-notice";

// Strip Clerk's card chrome so the form reads freeform against the page (our
// own header comes from AuthShell), and hide Clerk's built-in "Sign in" title.
const borderless = {
  rootBox: "w-full",
  cardBox: "w-full border-0 bg-transparent shadow-none",
  card: "border-0 bg-transparent p-0 shadow-none",
  header: "hidden",
  footer: "bg-transparent",
} as const;

export default function SignInPage() {
  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back — log in to your lurq account."
    >
      <SignIn
        forceRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
        appearance={{ elements: borderless }}
      />
      <AuthNotice mode="sign-in" />
    </AuthShell>
  );
}
