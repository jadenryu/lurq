// NOTE: placeholder testimonials for v1 (pre-launch). Replace with real,
// attributed quotes before publishing – do not present these as genuine.
export type Review = {
  quote: string;
  name: string;
  role: string;
  initials: string;
};

export const reviews: Review[] = [
  {
    quote:
      "My agent stopped suggesting packages that were deprecated a year ago. That alone paid for itself.",
    name: "Dana Whitfield",
    role: "Staff Engineer",
    initials: "DW",
  },
  {
    quote:
      "The verify tool caught a typosquatted dependency before it ever hit our lockfile.",
    name: "Marco Reyes",
    role: "Platform Lead",
    initials: "MR",
  },
  {
    quote:
      "Finally, recommendations backed by signals instead of vibes. The confidence labels are clutch.",
    name: "Priya Nair",
    role: "Frontend Architect",
    initials: "PN",
  },
  {
    quote:
      "compare turned a two-hour evaluation into a thirty-second answer I could trust.",
    name: "Sam Okafor",
    role: "Indie Dev",
    initials: "SO",
  },
  {
    quote:
      "Dropping it into Cursor took one command. It just shows up where I already work.",
    name: "Lena Hoffmann",
    role: "Full-stack Engineer",
    initials: "LH",
  },
  {
    quote:
      "The freshness is the whole point. New libraries my model had never heard of, scored and ready.",
    name: "Theo Vasquez",
    role: "DX Engineer",
    initials: "TV",
  },
  {
    quote:
      "Token-aware responses mean I'm not burning context on giant package dumps. Clean.",
    name: "Aisha Karim",
    role: "ML Infra",
    initials: "AK",
  },
  {
    quote:
      "The diagram tool sketched a sane reference stack I could hand straight to my team.",
    name: "Niko Petrov",
    role: "Tech Lead",
    initials: "NP",
  },
];
