import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/common/logo";
import { Container } from "@/components/common/container";

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="h-16 border-b border-border">
        <Container className="flex h-16 items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <UserButton />
        </Container>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dashboard coming soon
          </h1>
          <p className="mt-3 max-w-md text-muted-foreground">
            Usage metrics, performance, and API keys will live here. This is a
            placeholder for future development.
          </p>
        </div>
      </main>
    </div>
  );
}
