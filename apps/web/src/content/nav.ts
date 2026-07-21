export type NavLink = {
  label: string;
  href: string;
  // Cross-zone link (e.g. the /docs multi-zone); render as a plain <a> so it
  // does a real navigation instead of a client-side route Next can't resolve.
  external?: boolean;
};

// Anchors follow homepage story order: product → difference → faq.
// Bakeoff stays on-page as quiet proof, not a nav highlight.
export const navLinks: NavLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Difference", href: "/#comparison" },
  { label: "Changelog", href: "/changelog" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/#faq" },
];
