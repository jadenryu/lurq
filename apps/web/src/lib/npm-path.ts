/**
 * Paths under /npm, for package pages and their upgrade pages. Pure, and kept
 * apart from public-packages.ts so it can be tested from the repo root.
 */

/** The page path for a package. Scoped names keep their slash as a real segment. */
export function packagePath(name: string): string {
  return `/npm/${name.split("/").map(encodeURIComponent).join("/")}`;
}

export function upgradePath(name: string, fromMajor: number, toMajor: number): string {
  return `${packagePath(name)}/${fromMajor}-to-${toMajor}`;
}

/**
 * What an /npm/... path means: a package, or an upgrade page for one.
 *
 * The last segment reads as an upgrade only when what precedes it is a whole
 * package name. `@scope/1-to-2` is a scoped package whose name happens to look
 * like a jump, not an upgrade of the bare scope.
 */
export function parseNpmPath(
  segments: string[],
): { kind: "package"; name: string } | { kind: "upgrade"; name: string; from: number; to: number } {
  const parts = segments.map((s) => decodeURIComponent(s));
  const jump = /^(\d{1,6})-to-(\d{1,6})$/.exec(parts.at(-1) ?? "");
  const rest = parts.slice(0, -1);
  if (jump && rest.length > 0 && !(rest.length === 1 && rest[0]!.startsWith("@"))) {
    const from = Number(jump[1]);
    const to = Number(jump[2]);
    if (to > from) return { kind: "upgrade", name: rest.join("/"), from, to };
  }
  return { kind: "package", name: parts.join("/") };
}
