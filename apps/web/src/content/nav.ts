export type NavLink = {
  label: string;
  href: string;
  // Cross-zone link (e.g. the /docs multi-zone); render as a plain <a> so it
  // does a real navigation instead of a client-side route Next can't resolve.
  external?: boolean;
};

// Anchors resolve to sections rendered on the marketing home page
// (section-showcase #product, section-comparison, section-faq), plus the
// real /changelog and /about routes.
export const navLinks: NavLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Comparison", href: "/#comparison" },
  { label: "Changelog", href: "/changelog" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/#faq" },
];
