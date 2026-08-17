/**
 * Normalized surface of an OpenAPI document.
 *
 * The same idea as `src/surface/extract.ts`, pointed at a service instead of a
 * package: reduce a document to the set of promises it makes to callers, so two
 * revisions can be compared without diffing YAML. What a consumer can break
 * against is a small, boring list — the operation exists, the fields I must send,
 * the statuses I switch on — and everything else in an OpenAPI file (summaries,
 * tags, examples, servers) is prose that must never move a verdict.
 *
 * Structural, not semantic: this reads the document as written. A `$ref` into
 * `components` is resolved one level so required-field lists are real, but no
 * remote refs are fetched and no document is validated against the spec. An
 * unreadable file is reported as unreadable, never as an empty API — the §6.4.2
 * discipline from the package side applies identically here, and for the same
 * reason: an empty surface diffed against a real one reports the whole API as
 * deleted.
 */
import { parse as parseYaml } from 'yaml';

/** One promise the API makes: `GET /v1/customers/{id}`. */
export interface Operation {
  /** `METHOD path`, the identity a consumer codes against. */
  id: string;
  method: string;
  path: string;
  /** Parameters the caller MUST send. Adding one breaks every existing caller. */
  requiredParams: string[];
  optionalParams: string[];
  /** Required properties of the request body, flattened across content types. */
  requiredBodyFields: string[];
  /** Documented status codes. Callers switch on these, so a removal breaks them. */
  responseCodes: string[];
  deprecated: boolean;
}

export interface ApiSurface {
  title: string | null;
  /** `info.version` as written — not always semver, so callers must not assume. */
  version: string | null;
  operations: Map<string, Operation>;
  /** Set when nothing could be read. Callers must not treat the map as empty. */
  unreadableReason?: string;
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

type Doc = Record<string, unknown>;

const isRecord = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Resolve a local `$ref` (`#/components/schemas/Foo`) against the root document.
 *
 * Local only, and one hop at a time. Fetching a remote ref would make a CI check
 * depend on a network it has no reason to touch, and following a chain without a
 * seen-set is how a self-referential schema hangs the process; anything that does
 * not resolve is treated as "not established" rather than as an empty schema.
 */
function deref(root: Doc, node: unknown, seen = new Set<string>()): Doc | null {
  if (!isRecord(node)) return null;
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  if (!ref.startsWith('#/') || seen.has(ref)) return null;
  seen.add(ref);
  let cursor: unknown = root;
  for (const segment of ref.slice(2).split('/')) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return deref(root, cursor, seen);
}

/** Parameter names split by whether the caller has to send them. */
function readParams(
  root: Doc,
  shared: unknown,
  own: unknown,
): { required: string[]; optional: string[] } {
  const required = new Set<string>();
  const optional = new Set<string>();
  // Path-level parameters apply to every operation under it, and an operation
  // may override one by name. Merging with the operation last is what makes an
  // override read as an override rather than as a duplicate.
  for (const list of [shared, own]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const param = deref(root, raw);
      const name = param?.name;
      if (typeof name !== 'string') continue;
      // Keyed by name and location: `id` in the path and `id` in the query are
      // different promises, and collapsing them hides a real move between the two.
      const key = `${name} (${typeof param?.in === 'string' ? param.in : 'unknown'})`;
      if (param?.required === true) {
        required.add(key);
        optional.delete(key);
      } else if (!required.has(key)) {
        optional.add(key);
      }
    }
  }
  return { required: [...required].sort(), optional: [...optional].sort() };
}

/**
 * Required request-body properties, unioned across content types.
 *
 * Unioned rather than per-media-type: a field required in the JSON body and
 * absent from the form encoding is still a field some callers must now send, and
 * reporting it once is what a reader can act on. A body that is itself optional
 * contributes nothing — its fields are only required *if* you send a body.
 */
function readBodyFields(root: Doc, requestBody: unknown): string[] {
  const body = deref(root, requestBody);
  if (!body || body.required !== true) return [];
  const content = body.content;
  if (!isRecord(content)) return [];
  const out = new Set<string>();
  for (const media of Object.values(content)) {
    const schema = deref(root, isRecord(media) ? media.schema : null);
    const required = schema?.required;
    if (!Array.isArray(required)) continue;
    for (const field of required) if (typeof field === 'string') out.add(field);
  }
  return [...out].sort();
}

/**
 * Parse an OpenAPI document (JSON or YAML) into its surface.
 *
 * Never throws for a document-side problem: a malformed file returns
 * `unreadableReason`, which the caller reports as inconclusive rather than as an
 * API with no operations.
 */
export function extractApiSurface(source: string, label = 'document'): ApiSurface {
  const empty: ApiSurface = { title: null, version: null, operations: new Map() };

  let doc: unknown;
  try {
    // `yaml` parses JSON too — JSON is a YAML subset — so one path handles both
    // and there is no format sniffing to get wrong on a `.txt` or an extensionless
    // file piped in from git.
    doc = parseYaml(source);
  } catch (err) {
    return {
      ...empty,
      unreadableReason: `${label} is not valid YAML or JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(doc)) return { ...empty, unreadableReason: `${label} is not an object` };
  if (!doc.openapi && !doc.swagger) {
    return { ...empty, unreadableReason: `${label} has no openapi/swagger version field` };
  }

  const info = isRecord(doc.info) ? doc.info : {};
  const paths = isRecord(doc.paths) ? doc.paths : {};
  const operations = new Map<string, Operation>();

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(doc, rawItem);
    if (!item) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isRecord(op)) continue;
      const { required, optional } = readParams(doc, item.parameters, op.parameters);
      const responses = isRecord(op.responses) ? Object.keys(op.responses).sort() : [];
      const id = `${method.toUpperCase()} ${path}`;
      operations.set(id, {
        id,
        method: method.toUpperCase(),
        path,
        requiredParams: required,
        optionalParams: optional,
        requiredBodyFields: readBodyFields(doc, op.requestBody),
        responseCodes: responses,
        deprecated: op.deprecated === true,
      });
    }
  }

  return {
    title: typeof info.title === 'string' ? info.title : null,
    version: typeof info.version === 'string' ? info.version : null,
    operations,
    ...(operations.size === 0
      ? { unreadableReason: `${label} declares no operations` }
      : {}),
  };
}
