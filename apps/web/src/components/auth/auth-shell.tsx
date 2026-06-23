import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/common/logo";

// Two-column auth layout adapted from shadcn's `login-02` block: the auth
// element (Clerk) sits on the left; the right panel shows the lurq logo.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          {children}
        </div>
      </div>
      <div className="relative hidden items-center justify-center bg-muted lg:flex">
        <Image
          src="/logos/logo.png"
          alt="lurq"
          width={320}
          height={320}
          priority
          className="h-44 w-44 object-contain opacity-90"
        />
      </div>
    </div>
  );
}
