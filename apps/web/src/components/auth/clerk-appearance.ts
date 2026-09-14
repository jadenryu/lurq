// Make Clerk's widget fully freeform, with no card border, background, or shadow,
// so it reads flat against the AuthShell. className overrides lose to Clerk's
// own stylesheet on the card chrome, so use inline style OBJECTS: they're
// applied as inline styles and always win on specificity. The chrome lives on
// three ids: `cardBox` (outer), `card` (inner), and a gray `footer` that sits
// outside `card` but inside `cardBox`. Flatten all three. Shared by sign-in and
// sign-up so both look identical.
const hairline = "1px solid rgba(255,255,255,0.28)"; // light border on near-black

/**
 * GitHub first, on every Clerk form: these pages and every sign-up modal.
 *
 * Everyone lurq is for has a GitHub account, and it is the one-click path: no
 * password, no emailed code, an address GitHub already verified. So GitHub is
 * the filled button and email is the outlined fallback under it. Before this,
 * `colorPrimary` made the email form's Continue the only filled button, so the
 * slow path was the one that looked recommended.
 *
 * `blockButton` is pinned because Clerk switches to bare icons at three
 * providers, which would shrink GitHub to a glyph the day another is enabled.
 */
export const clerkOptions = {
  socialButtonsPlacement: "top",
  socialButtonsVariant: "blockButton",
} as const;

export const githubFirstElements = {
  socialButtonsBlockButton__github: {
    background: "#fafafa",
    border: "1px solid #fafafa",
    "&:hover": { background: "#e4e4e7" },
  },
  socialButtonsBlockButtonText__github: { color: "#0a0a0a", fontWeight: 600 },
  // Clerk 7 draws provider marks as a CSS mask painted with background-color
  // (white here), and the dark theme adds invert(1) on top. So the mark is
  // coloured, not filtered: paint it near-black and drop the invert, or it is
  // white on the white button.
  providerIcon__github: { backgroundColor: "#0a0a0a", filter: "none" },
  socialButtonsProviderIcon__github: { backgroundColor: "#0a0a0a", filter: "none" },
  // One column. Clerk lays block buttons out as one grid row, which at three
  // providers truncates the labels ("X / Twi…") in the modal. Stacked, GitHub
  // is the full-width first row whatever the dashboard enables.
  socialButtons: { gridTemplateColumns: "1fr" },
  formButtonPrimary: {
    background: "transparent",
    color: "#fafafa",
    border: hairline,
    boxShadow: "none",
    "&:hover": { background: "rgba(255,255,255,0.06)" },
  },
} as const;

export const borderlessAppearance = {
  elements: {
    // A class, not a style object: globals.css gives it the full width and the
    // fade-in, so Clerk's form arrives instead of popping in once its script loads.
    rootBox: "auth-clerk-root",
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

    // Same GitHub-first treatment as the modals get from ClerkProvider. Spread
    // last, and nothing above sets these keys, so a component-level override
    // can never quietly undo it on just these two pages.
    ...githubFirstElements,
  },
  options: clerkOptions,
} as const;
