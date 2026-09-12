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
      <main id="content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 sm:px-6 md:px-8 md:py-7">
        {/* Was max-w-5xl. A 1024px column of cards centred in a 2560px window is
            the loudest "this is a website with a login" tell there is: every
            console you'd want to be mistaken for runs the full width and spends
            it on data. 1440 is the stop where a 4-up strip and a 30-day column
            chart still have sane proportions. */}
        <div className="mx-auto w-full max-w-[1440px]">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
