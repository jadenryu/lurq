// Make Clerk's widget fully freeform — no card border, background, or shadow —
// so it reads flat against the AuthShell. className overrides lose to Clerk's
// own stylesheet on the card chrome, so use inline style OBJECTS: they're
// applied as inline styles and always win on specificity. The chrome lives on
// three ids: `cardBox` (outer), `card` (inner), and a gray `footer` that sits
// outside `card` but inside `cardBox`. Flatten all three. Shared by sign-in and
// sign-up so both look identical.
const hairline = "1px solid rgba(255,255,255,0.14)"; // faint light border on near-black

export const borderlessAppearance = {
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      border: "none",
      boxShadow: "none",
      background: "transparent",
      // Clerk sets overflow:hidden on the card box for its rounded corners;
      // with our zero card padding that clips the flush-left legal checkbox.
      overflow: "visible",
    },
    card: {
      border: "none",
      boxShadow: "none",
      background: "transparent",
      // small horizontal inset so controls (esp. the legal checkbox) aren't
      // flush against the edge; vertical stays tight for the freeform look.
      padding: "0 2px",
      overflow: "visible",
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

    // Subtle 1px hairline on the interactive elements for definition (freeform
    // layout, but each control still reads as its own surface).
    socialButtonsBlockButton: { border: hairline },
    formFieldInput: { border: hairline },
    formButtonPrimary: { border: hairline },

    // GitHub's mark is solid black → invisible on our dark buttons. Force it
    // white (brightness(0) flattens to black, invert(1) flips black→white).
    socialButtonsProviderIcon__github: { filter: "brightness(0) invert(1)" },
  },
} as const;
