import Link from "next/link";

// Legal consent notice shown under the Clerk auth form. Sign-up carries the full
// account-creation + marketing-email disclosure; sign-in a shorter agreement
// line. Links route to the /terms and /privacy pages.
export function AuthNotice({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
      {mode === "sign-up" ? (
        <>
          By creating an account you agree to the <TermsLink /> and our{" "}
          <PrivacyLink />. We&apos;ll occasionally send you emails about news,
          products, and services; you can opt-out anytime.
        </>
      ) : (
        <>
          By logging in you agree to our <TermsLink /> and <PrivacyLink />.
        </>
      )}
    </p>
  );
}

function TermsLink() {
  return (
    <Link
      href="/terms"
      className="underline underline-offset-2 hover:text-foreground"
    >
      Terms of Service
    </Link>
  );
}

function PrivacyLink() {
  return (
    <Link
      href="/privacy"
      className="underline underline-offset-2 hover:text-foreground"
    >
      Privacy Policy
    </Link>
  );
}
