// Strip Clerk's card chrome so the auth form reads freeform against the
// AuthShell (our title/subtitle come from AuthShell, not Clerk's header).
// Shared by the sign-in and sign-up pages so both look identical.
export const borderlessAppearance = {
  elements: {
    rootBox: "w-full",
    cardBox: "w-full border-0 bg-transparent shadow-none",
    card: "border-0 bg-transparent p-0 shadow-none",
    header: "hidden",
    // keep the "Sign up / Sign in" link visible, just drop its card footer bg
    footer: "border-0 bg-transparent shadow-none",
    footerAction: "bg-transparent",
  },
} as const;
