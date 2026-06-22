// Prices are final ($0 / $5 / $100 per month). Call-limit numbers below are
// placeholders — confirm real quotas before publishing.
export type Plan = {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaType: "signup" | "contact";
  featured?: boolean;
};

export const plans: Plan[] = [
  {
    name: "Free",
    price: "$0",
    period: "/mo",
    description: "The CLI and a taste of the hosted index.",
    features: [
      "CLI + installable agent skill",
      "Up to 200 hosted calls / month",
      "recommend, evaluate, verify",
      "Daily-refreshed index",
      "Community support",
    ],
    cta: "Get started",
    ctaType: "signup",
  },
  {
    name: "Pro",
    price: "$5",
    period: "/mo",
    description: "For developers who live in their agent.",
    features: [
      "Everything in Free",
      "10,000 hosted calls / month",
      "compare + diagram tools",
      "Priority freshness",
      "Email support",
    ],
    cta: "Start Pro",
    ctaType: "signup",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "$100",
    period: "/mo",
    description: "For teams that need scale and controls.",
    features: [
      "Everything in Pro",
      "Unlimited hosted calls",
      "SSO + audit logs",
      "Custom SLA",
      "Dedicated support",
    ],
    cta: "Contact sales",
    ctaType: "contact",
  },
];
