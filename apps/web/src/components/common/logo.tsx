import Image from "next/image";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex select-none items-center gap-2", className)}>
      <Image
        src="/logos/logo.png"
        alt="lurq logo"
        width={32}
        height={32}
        priority
        className="h-7 w-7 object-contain"
      />
      {showWordmark && (
        <span className="text-lg font-semibold tracking-tight text-foreground">
          lurq
        </span>
      )}
    </span>
  );
}
