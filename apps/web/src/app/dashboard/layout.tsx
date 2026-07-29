import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/common/logo";
import { DashboardNav } from "@/components/dashboard/sidebar-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="h-16 shrink-0 border-b border-border bg-background/80 px-6 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <UserButton />
        </div>
      </header>
      <div className="flex flex-1">
        <DashboardNav />
        <main className="min-w-0 flex-1 px-6 py-16 md:px-10 md:py-20">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
