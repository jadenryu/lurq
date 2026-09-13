# lurq

The `lurq` MCP server is connected. It is a daily-resynced, evidence-scored index of npm
packages, so it knows things your training data cannot: current health and quality scores,
advisories, and the exact exported API of a given version.

Use it instead of recalling package facts:

- `verify <pkg>` before adding any dependency. Catches hallucinated, typosquatted,
  deprecated, and advisory-carrying names. Cheapest and highest-value call.
- `compare <pkgs>` to choose between candidate libraries you already know of; `evaluate <pkg>`
  for the full evidence read. lurq checks candidates, it does not search for them.
- `compat <pkgs>` before committing to a multi-package stack. Healthy packages can still
  refuse to install together.
- `usage <pkg> --known <version-you-remember>` before writing code against an API that may
  have moved. Returns real exported symbols plus the delta from the version you know. Large
  surfaces are paged: pass `query` with part of a name to find a symbol directly.
- `resolve_surface <pkg>` when you need to know whether a symbol exists at runtime, not
  just in the types. A removed type breaks `tsc`; a removed runtime export breaks the
  program. UNKNOWN means "not extracted yet", never "absent".
- `diff_surface <pkg> <from> <to>` to answer "when did this stop working", and before an
  upgrade. Static comparison of both versions, no install required.

Every response carries a `dataAsOf` timestamp. Scores are deterministic and the weights are
public. For framework file layout and conventions rather than exported symbols, follow the
project's official migration guide instead.
