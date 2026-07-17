// Make Clerk's widget fully freeform — no card border, background, or shadow —
// so it reads flat against the AuthShell. className overrides lose to Clerk's
// own stylesheet on the card chrome, so use inline style OBJECTS: they're
// applied as inline styles and always win on specificity. The chrome lives on
// three ids: `cardBox` (outer), `card` (inner), and a gray `footer` that sits
// outside `card` but inside `cardBox`. Flatten all three. Shared by sign-in and
// sign-up so both look identical.
export const borderlessAppearance = {
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      border: "none",
      boxShadow: "none",
      background: "transparent",
    },
    card: {
      border: "none",
      boxShadow: "none",
      background: "transparent",
      padding: 0,
    },
    // our title/subtitle come from AuthShell, not Clerk's header
    header: { display: "none" },
    // keep the "Sign up / Sign in" link visible, just drop the gray footer bar
    footer: {
      background: "transparent",
      boxShadow: "none",
      borderTop: "none",
    },
    footerItem: { background: "transparent" },
  },
} as const;
