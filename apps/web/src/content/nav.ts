/**
 * The site's information architecture, in one file.
 *
 * WHY A DATA FILE. The nav, the footer, the /product index and the /solutions
 * index all render the same set of destinations. When each of them held its own
 * list the footer was the one that went stale: it still had no Solutions column
 * two passes after the pages existed. A route added here appears in all four.
 *
 * House rules from content/copy.ts apply and are the reason the blurbs read the
 * way they do: sentence case, no em dashes, and one clause each. A menu blurb
 * that runs to two lines is a paragraph in a place nobody reads paragraphs.
 *
 * Every `href` below resolves to a route that exists. See the footer's own note:
 * inventing a destination to balance a column is how a site starts lying about
 * its own size.
 */
import { DOCS_URL } from "@/lib/site-links";
import { REPO_URL } from "@/lib/marketing-copy";

export interface NavLink {
  label: string;
  href: string;
  /** One clause, rendered under the label in the mega menu. */
  blurb?: string;
  external?: boolean;
  /** Renders a "New" pip. Reserved for things shipped in the last release. */
  fresh?: boolean;
}

export interface NavColumn {
  /** Mono, uppercase, 11px. The menu's only all-caps text. */
  heading: string;
  links: NavLink[];
}

export interface NavMenu {
  label: string;
  /** Where the trigger goes if someone clicks it rather than hovering. */
  href: string;
  columns: NavColumn[];
  /**
   * The panel's right rail: one promoted destination with room for a figure.
   * Optional, because a menu with three balanced columns does not want a fourth
   * element competing with them.
   */
  feature?: {
    eyebrow: string;
    title: string;
    body: string;
    href: string;
    cta: string;
  };
}

/**
 * PRODUCT. Grouped by the question each tool answers rather than by tool name,
 * which is the same rule content/capabilities.ts follows and for the same
 * reason: `resolve_surface` means nothing to someone who has not read the docs,
 * "what does this version actually export" means something to everyone.
 */
export const PRODUCT_MENU: NavMenu = {
  label: "Product",
  href: "/product",
  columns: [
    {
      heading: "Check",
      links: [
        {
          label: "Verify",
          href: "/product/verify",
          blurb: "Is the package real, and is it healthy?",
        },
        {
          label: "Evaluate",
          href: "/product/evaluate",
          blurb: "The full evidence read on one package.",
        },
        {
          label: "Compare",
          href: "/product/compare",
          blurb: "Two to five candidates, ranked on evidence.",
        },
      ],
    },
    {
      heading: "Fit",
      links: [
        {
          label: "Compat",
          href: "/product/compat",
          blurb: "Will the whole set install together?",
        },
        {
          label: "Usage",
          href: "/product/usage",
          blurb: "The API at a version, and the delta from yours.",
        },
        {
          label: "Diagram",
          href: "/product/diagram",
          blurb: "A reference architecture for a chosen stack.",
        },
      ],
    },
    {
      heading: "Surface",
      links: [
        {
          label: "Resolve surface",
          href: "/product/resolve_surface",
          blurb: "What a version exports at runtime, not in the docs.",
        },
        {
          label: "Diff surface",
          href: "/product/diff_surface",
          blurb: "What broke between two versions, before you upgrade.",
        },
        {
          label: "All ten tools",
          href: "/product",
          blurb: "The complete surface, with live examples.",
        },
      ],
    },
  ],
  feature: {
    eyebrow: "The index",
    title: "Everything traces to a host you can check",
    body: "44,091 packages scored, 4.02M versions tracked, 27M co-install pairs, read from ten public sources on a daily crawl.",
    href: "/proof",
    cta: "See the evidence",
  },
};

/**
 * SOLUTIONS, by use case rather than by persona. lurq has no named customers
 * yet, so a persona page would be a claim about who uses it; a use-case page is
 * a claim about what it does, which is checkable.
 */
export const SOLUTIONS_MENU: NavMenu = {
  label: "Solutions",
  href: "/solutions",
  columns: [
    {
      heading: "By use case",
      links: [
        {
          label: "Agent-assisted coding",
          href: "/solutions/agent-coding",
          blurb: "Check the suggestion before it becomes an install.",
        },
        {
          label: "Upgrades and migrations",
          href: "/solutions/upgrades",
          blurb: "Know what breaks before you bump the version.",
        },
      ],
    },
    {
      heading: "By workflow",
      links: [
        {
          label: "Pre-merge gating",
          href: "/solutions/ci",
          blurb: "Fail the build on a dependency nobody checked.",
        },
        {
          label: "Supply-chain defence",
          href: "/solutions/supply-chain",
          blurb: "Catch the package name a model invented.",
        },
      ],
    },
    {
      heading: "By surface",
      links: [
        { label: "Claude Code and Cursor", href: "/solutions/agent-coding#surfaces" },
        { label: "MCP server", href: "/product#mcp" },
        { label: "CLI in CI", href: "/solutions/ci#cli" },
      ],
    },
  ],
  feature: {
    eyebrow: "Start here",
    title: "One command, then it is in every assistant you have",
    body: "Setup finds the clients already installed and writes a keyed MCP entry and a skill file for each of them.",
    href: "/#use",
    cta: "See the setup",
  },
};

/**
 * RESOURCES. Three of these are pages that carry data rather than argument,
 * which is why they are grouped away from Product: someone opening this menu is
 * checking us, not shopping.
 */
export const RESOURCES_MENU: NavMenu = {
  label: "Resources",
  href: "/proof",
  columns: [
    {
      heading: "Read",
      links: [
        { label: "Docs", href: DOCS_URL, blurb: "Install, tools, and the HTTP API." },
        { label: "Changelog", href: "/changelog", blurb: "Every release, and what moved.", fresh: true },
        { label: "GitHub", href: REPO_URL, blurb: "MIT, and the whole client is in it.", external: true },
      ],
    },
    {
      heading: "Check",
      links: [
        { label: "Evidence", href: "/proof", blurb: "How the numbers on this site are produced." },
        { label: "Pricing", href: "/#pricing", blurb: "What is free, and what the index costs." },
        { label: "Status", href: "/proof#status", blurb: "Index freshness and the last crawl." },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Partnerships", href: "/partnerships" },
        { label: "Book a demo", href: "/book-demo" },
      ],
    },
  ],
};

export const MENUS: NavMenu[] = [PRODUCT_MENU, SOLUTIONS_MENU, RESOURCES_MENU];

/** Flat links that sit beside the menus. Kept to one: a fourth trigger crowds the pill. */
export const FLAT_LINKS: NavLink[] = [{ label: "Pricing", href: "/#pricing" }];
