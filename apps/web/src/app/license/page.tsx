import type { Metadata } from "next";
import { Check, FileText, Ban } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "License | lurq",
  description: "lurq is open source under the Apache License 2.0.",
};

const columns = [
  {
    icon: Check,
    title: "Permissions",
    items: [
      "Commercial use",
      "Modification",
      "Distribution",
      "Patent use",
      "Private use",
    ],
  },
  {
    icon: FileText,
    title: "Conditions",
    items: ["License & copyright notice", "State changes"],
  },
  {
    icon: Ban,
    title: "Limitations",
    items: ["No trademark use", "No liability", "No warranty"],
  },
];

export default function LicensePage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="License"
      lead="lurq is open source, released under the Apache License, Version 2.0."
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
          You may use, modify, and distribute lurq — including commercially —
          provided you retain the copyright and license notices and state any
          significant changes. The software is provided <strong>as is</strong>,
          without warranty of any kind. This summary is for convenience only; the
          full license text governs.
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
          file in the repository, and is reproduced verbatim from the{" "}
          <a
            href="https://www.apache.org/licenses/LICENSE-2.0"
            target="_blank"
            rel="noopener noreferrer"
          >
            Apache Software Foundation
          </a>
          .
        </p>

        <p>
          <strong>Copyright © 2026 lurq.</strong> Licensed under the Apache
          License, Version 2.0.
        </p>
      </Prose>
    </PageShell>
  );
}
