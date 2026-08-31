import type { Metadata } from "next";
import { UserProfile } from "@clerk/nextjs";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "profile",
  description: "Your account, email addresses, connected logins and security settings.",
};

/**
 * Clerk's own <UserProfile />, mounted inline.
 *
 * ponytail: no custom form. Email verification, password changes, connected
 * OAuth accounts, MFA enrolment, active sessions and account deletion are all
 * already implemented, already localised and already the thing Clerk keeps
 * current as its own security surface changes. Rebuilding any of that against
 * the same SDK would be a worse copy of it that we would then own.
 *
 * `routing="hash"` rather than the default path routing: path routing wants the
 * profile mounted at an optional-catch-all segment (`profile/[[...rest]]`) so
 * Clerk can own its sub-routes, and that would make this the only page in the
 * dashboard whose folder name does not match its URL. Hash routing keeps the
 * route a plain `/dashboard/profile` and Clerk navigates within it.
 *
 * The account menu's `openUserProfile()` modal still works and is untouched —
 * this is the same component, given a page to live on for anyone who reaches
 * for the nav instead of the avatar.
 */
export default function DashboardProfilePage() {
  return (
    <div>
      <PageHeader
        title="profile"
        subtitle="Your account, email addresses, connected logins and security settings."
      />

      {/* Clerk sizes its own card and centres it. Left-aligned here so it sits
          on the same rail as every other panel in the dashboard rather than
          drifting to the middle of a page whose header is hard left. */}
      <PageBody className="[&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-cardBox]:max-w-none">
        <UserProfile routing="hash" />
      </PageBody>
    </div>
  );
}
