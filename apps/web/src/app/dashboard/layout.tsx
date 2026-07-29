import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { DashboardNav } from "@/components/dashboard/sidebar-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <DashboardNav />
      <main className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
