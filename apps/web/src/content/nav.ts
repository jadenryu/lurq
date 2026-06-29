export type NavLink = {
  label: string;
  href: string;
  // Cross-zone link (e.g. the /docs multi-zone); render as a plain <a> so it
  // does a real navigation instead of a client-side route Next can't resolve.
  external?: boolean;
};

export const navLinks: NavLink[] = [
  { label: "Product", href: "#product" },
  { label: "Docs", href: "/docs", external: true },
  { label: "Reviews", href: "#reviews" },
];
