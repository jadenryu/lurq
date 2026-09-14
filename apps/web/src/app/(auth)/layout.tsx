import { AuthShell } from "@/components/auth/auth-shell";

/**
 * One shell for /sign-in and /sign-up. Each page used to render its own AuthShell,
 * so following Clerk's "Sign in" / "Sign up" link unmounted the brand panel and the
 * whole column and mounted identical copies: a hard cut between two pages that are
 * the same page. As a layout it stays mounted, and only the form column changes.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
