import Link from "next/link";

// Notice shown under the Clerk auth form. Terms/Privacy agreement on sign-up is
// handled by Clerk's own legal-consent checkbox (Dashboard → Legal), so sign-up
// here only carries the marketing-email opt-out disclosure that the checkbox
// doesn't cover. Sign-in has no checkbox, so it keeps the agreement line.
export function AuthNotice({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
      {mode === "sign-up" ? (
        <>
          We&apos;ll occasionally send you emails about news, products, and
          services; you can opt-out anytime.
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
