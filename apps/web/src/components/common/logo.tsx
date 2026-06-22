import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "select-none text-lg font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      lurq
    </span>
  );
}
