"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Our own account control, replacing Clerk's `<UserButton>`.
 *
 * The stock widget renders Clerk's own popover — its border radius, its type
 * scale, a "Secured by Clerk" footer and a "Development mode" badge — none of
 * which we can bring in line with the rest of the dashboard. This keeps the
 * same capabilities (profile, sign out) using our dropdown primitive, so the
 * chrome is ours end to end. Clerk's account modal is still what opens for
 * profile management; we just stop borrowing its trigger and menu.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();

  const name = user?.fullName ?? user?.username ?? "Account";
  const email = user?.primaryEmailAddress?.emailAddress;
  const initials =
    (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "") ||
    name.slice(0, 2).toUpperCase();

  const avatar = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-secondary font-mono text-[0.7rem] uppercase text-muted-foreground",
        compact ? "size-7" : "size-8",
      )}
    >
      {user?.imageUrl ? (
        // Clerk serves a CDN URL; next/image would need remotePatterns config for
        // an avatar that's already correctly sized.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.imageUrl} alt="" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );

  if (!isLoaded) {
    // Reserve the row so the sidebar footer doesn't jump when the user resolves.
    return <div className={cn("w-full", compact ? "h-9" : "h-12")} aria-hidden />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-colors",
          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal/40",
        )}
      >
        {avatar}
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight">{name}</span>
              {email && (
                <span className="block truncate font-mono text-[0.65rem] leading-tight text-ink-3">
                  {email}
                </span>
              )}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-medium leading-tight">{name}</p>
          {email && (
            <p className="truncate font-mono text-[0.65rem] leading-tight text-ink-3">
              {email}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openUserProfile()}>
          <Settings className="size-4" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOut({ redirectUrl: "/" })}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
