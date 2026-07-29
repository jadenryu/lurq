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
      <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 md:px-8">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          <UserButton />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <DashboardNav />
        <main className="min-w-0 flex-1 px-6 py-10 md:px-10 md:py-12">{children}</main>
      </div>
    </div>
  );
}
