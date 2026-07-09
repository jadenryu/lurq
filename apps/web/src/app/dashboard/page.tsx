import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/common/logo";
import { Container } from "@/components/common/container";
import { KeyIssuer } from "@/components/dashboard/key-issuer";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

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
      <main className="flex-1 px-6 py-16">
        <Container className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Your API key</h1>
          <p className="mt-3 text-muted-foreground">
            Generate a key below, then run <code className="font-mono">npx lurqrun install</code>{" "}
            and paste it to connect Claude Code, Cursor, Windsurf, Copilot, or Codex to lurq.
          </p>
          <div className="mt-8">
            <KeyIssuer />
          </div>
          <p className="mt-10 text-sm text-muted-foreground">
            Your recommendations and outcomes are tied to your account, so lurq learns what works
            for your stack.
          </p>
        </Container>
      </main>
    </div>
  );
}
