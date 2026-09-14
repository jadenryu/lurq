/**
 * The error messages a removed export produces, word for word, per tool.
 *
 * An agent that hits a broken upgrade searches the error it got, not "what did
 * this release remove". Printing the literal messages on the upgrade page is
 * what lets that search land on the page that explains the break and names the
 * fix.
 *
 * Only plain top-level named exports get messages. A member path (`Foo.bar`) or
 * `default` fails in ways that depend on how the code uses it, and a guessed
 * message would send the search somewhere wrong.
 *
 * Pure and free of Next imports, so root tests can import it.
 */

export interface ToolError {
  tool: string;
  message: string;
}

const NAME = /^[A-Za-z_$][\w$]*$/;
const plain = (name: string) => NAME.test(name) && name !== 'default';

/** Imports of `name` from `pkg` when the release removed it with no replacement. */
export function removedExportErrors(pkg: string, name: string): ToolError[] {
  if (!plain(name)) return [];
  return [
    { tool: 'Node.js (ESM)', message: `SyntaxError: The requested module '${pkg}' does not provide an export named '${name}'` },
    { tool: 'TypeScript', message: `error TS2305: Module '"${pkg}"' has no exported member '${name}'.` },
    { tool: 'webpack', message: `export '${name}' (imported as '${name}') was not found in '${pkg}'` },
    { tool: 'Vite / esbuild', message: `No matching export in "${pkg}" for import "${name}"` },
    { tool: 'Turbopack', message: `Export ${name} doesn't exist in target module` },
  ];
}

/** The same failures for a rename; TypeScript's message names the new export. */
export function renamedExportErrors(pkg: string, name: string, to: string): ToolError[] {
  const errors = removedExportErrors(pkg, name);
  if (!plain(to)) return errors;
  return errors.map((e) =>
    e.tool === 'TypeScript'
      ? { tool: e.tool, message: `error TS2724: Module '"${pkg}"' has no exported member named '${name}'. Did you mean '${to}'?` }
      : e,
  );
}

/** A type-only export: only the type check fails. */
export function typeExportErrors(pkg: string, name: string): ToolError[] {
  return plain(name) ? [{ tool: 'TypeScript', message: `error TS2305: Module '"${pkg}"' has no exported member '${name}'.` }] : [];
}

/** Names an upgrade page prints messages for. Past this the page is a wall of errors nobody reads. */
export const ERROR_NAMES_CAP = 15;

/**
 * The messages for one upgrade page: renames first (their message names the
 * fix), then removals, then types, capped at ERROR_NAMES_CAP names.
 */
export function upgradeErrors(
  pkg: string,
  u: { removed: { path: string }[]; renamed: { path: string; to: string[] }[]; typeOnlyRemoved: string[] },
): { name: string; errors: ToolError[] }[] {
  return [
    ...u.renamed.map((r) => ({ name: r.path, errors: renamedExportErrors(pkg, r.path, r.to[0] ?? '') })),
    ...u.removed.map((r) => ({ name: r.path, errors: removedExportErrors(pkg, r.path) })),
    ...u.typeOnlyRemoved.map((t) => ({ name: t, errors: typeExportErrors(pkg, t) })),
  ]
    .filter((e) => e.errors.length > 0)
    .slice(0, ERROR_NAMES_CAP);
}
