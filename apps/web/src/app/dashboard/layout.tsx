import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { DashboardNav } from "@/components/dashboard/sidebar-nav";
import { PageTransition } from "@/components/dashboard/motion";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    // `dashboard-type` remaps the two font tokens for this subtree only:
    // Geist headings, Inter body. See globals.css — the marketing route keeps
    // its own pairing.
    //
    // Padding steps down on mobile (px-6 → px-4) because at 390px the old value
    // spent 12% of the screen on gutters, which is what pushed tables and the
    // stat row into a horizontal scroll.
    <div className="dashboard-type flex min-h-screen flex-col md:flex-row">
      <DashboardNav />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10">
        <div className="mx-auto w-full max-w-5xl">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
