import type { Metadata } from "next";
import { Check, FileText, Ban } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "License | lurq",
  description: "lurq is open source under the MIT License.",
};

// These describe MIT, not Apache-2.0. The difference is not cosmetic: MIT
// grants no express patent licence and imposes no state-changes condition, so
// carrying over the old rows would have the page assert protections the licence
// in the repository does not actually give anyone.
const columns = [
  {
    icon: Check,
    title: "Permissions",
    items: [
      "Commercial use",
      "Modification",
      "Distribution",
      "Private use",
      "Sublicensing",
    ],
  },
  {
    icon: FileText,
    title: "Conditions",
    items: ["License & copyright notice"],
  },
  {
    icon: Ban,
    title: "Limitations",
    items: ["No liability", "No warranty"],
  },
];

export default function LicensePage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="License"
      lead="lurq is open source, released under the MIT License."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {columns.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.title}
              className="surface-glow rounded-[var(--radius-lg)] border border-border bg-card p-5"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-secondary text-foreground">
                  <Icon className="size-4" />
                </div>
                <h3 className="text-sm font-medium text-foreground">
                  {c.title}
                </h3>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {c.items.map((i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <Prose className="mt-12">
        <h2>Summary</h2>
        <p>
          You may use, modify, distribute, and sublicense lurq, including
          commercially and inside closed-source software. The single condition
          is that you keep the copyright and license notice with any substantial
          portion you redistribute. The software is provided{" "}
          <strong>as is</strong>, without warranty of any kind, and no patent
          rights are granted expressly. This summary is for convenience only;
          the full license text governs.
        </p>

        <h2>Full text</h2>
        <p>
          The complete license is included in the{" "}
          <a
            href="https://github.com/jadenryu/lurq/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
          >
            LICENSE
          </a>{" "}
          file in the repository.
        </p>

        <p>
          <strong>Copyright © 2026 Jaden Ryu.</strong> Licensed under the MIT
          License.
        </p>
      </Prose>
    </PageShell>
  );
}
