import { describe, expect, it } from 'vitest';
import { checkApi, diffApiSurfaces, formatApiCheck } from '../src/api/diff';
import { extractApiSurface } from '../src/api/openapi';

const spec = (body: string) => extractApiSurface(body);

const BASE = `
openapi: 3.0.0
info:
  title: Billing
  version: 1.2.3
paths:
  /v1/charges:
    post:
      parameters:
        - name: account
          in: query
          required: true
        - name: trace
          in: header
      requestBody:
        required: true
        content:
          application/json:
            schema:
              required: [amount]
      responses:
        '200': { description: ok }
        '402': { description: payment required }
  /v1/invoices/{id}:
    delete:
      parameters:
        - name: id
          in: path
          required: true
      responses:
        '204': { description: gone }
`;

describe('extractApiSurface', () => {
  it('reduces a document to its operations', () => {
    const surface = spec(BASE);
    expect([...surface.operations.keys()].sort()).toEqual([
      'DELETE /v1/invoices/{id}',
      'POST /v1/charges',
    ]);
    const charges = surface.operations.get('POST /v1/charges')!;
    expect(charges.requiredParams).toEqual(['account (query)']);
    expect(charges.optionalParams).toEqual(['trace (header)']);
    expect(charges.requiredBodyFields).toEqual(['amount']);
    expect(charges.responseCodes).toEqual(['200', '402']);
    expect(surface.version).toBe('1.2.3');
  });

  it('reads JSON as happily as YAML', () => {
    const json = spec(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'x', version: '1.0.0' },
        paths: { '/ping': { get: { responses: { '200': {} } } } },
      }),
    );
    expect(json.operations.has('GET /ping')).toBe(true);
  });

  it('applies path-level parameters to every operation under it', () => {
    const surface = spec(`
openapi: 3.0.0
info: { title: x, version: 1.0.0 }
paths:
  /things/{id}:
    parameters:
      - name: id
        in: path
        required: true
    get:
      responses: { '200': {} }
`);
    expect(surface.operations.get('GET /things/{id}')!.requiredParams).toEqual(['id (path)']);
  });

  it('resolves a local $ref so required fields are real', () => {
    const surface = spec(`
openapi: 3.0.0
info: { title: x, version: 1.0.0 }
paths:
  /things:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Thing'
      responses: { '201': {} }
components:
  schemas:
    Thing:
      required: [name, kind]
`);
    expect(surface.operations.get('POST /things')!.requiredBodyFields).toEqual(['kind', 'name']);
  });

  it('reports an unreadable document rather than an empty API', () => {
    expect(spec('this: [is: not: valid').unreadableReason).toBeTruthy();
    expect(spec('title: not an api').unreadableReason).toContain('openapi/swagger');
  });
});

describe('diffApiSurfaces', () => {
  it('calls a removed operation breaking', () => {
    const after = BASE.replace(/  \/v1\/invoices\/\{id\}:[\s\S]*$/, '');
    const diff = diffApiSurfaces(spec(BASE), spec(after));
    expect(diff.breaking).toHaveLength(1);
    expect(diff.breaking[0]).toMatchObject({
      kind: 'operation-removed',
      operation: 'DELETE /v1/invoices/{id}',
    });
  });

  it('separates a newly required param from one that was already optional', () => {
    const after = BASE.replace('        - name: trace\n          in: header', '        - name: trace\n          in: header\n          required: true').replace(
      "      responses:\n        '200': { description: ok }",
      "      parameters2: ignored\n      responses:\n        '200': { description: ok }",
    );
    const diff = diffApiSurfaces(spec(BASE), spec(after));
    expect(diff.breaking.map((c) => c.kind)).toContain('param-now-required');
  });

  it('treats a new required body field as breaking and a new optional param as not', () => {
    const after = BASE.replace('required: [amount]', 'required: [amount, currency]').replace(
      '        - name: trace\n          in: header',
      '        - name: trace\n          in: header\n        - name: locale\n          in: query',
    );
    const diff = diffApiSurfaces(spec(BASE), spec(after));
    expect(diff.breaking.map((c) => c.detail)).toContain('currency');
    expect(diff.other.map((c) => c.kind)).toContain('optional-param-added');
  });

  it('calls a removed response code breaking and an added one not', () => {
    const after = BASE.replace("        '402': { description: payment required }", "        '409': { description: conflict }");
    const diff = diffApiSurfaces(spec(BASE), spec(after));
    expect(diff.breaking.map((c) => c.kind)).toContain('response-removed');
    expect(diff.other.map((c) => c.kind)).toContain('response-added');
  });

  it('reports deprecation without counting it as a break', () => {
    const after = BASE.replace('    delete:', '    delete:\n      deprecated: true');
    const diff = diffApiSurfaces(spec(BASE), spec(after));
    expect(diff.breaking).toHaveLength(0);
    expect(diff.other.map((c) => c.kind)).toContain('operation-deprecated');
  });

  it('refuses to rule when either side could not be read', () => {
    expect(diffApiSurfaces(spec('nonsense: true'), spec(BASE)).inconclusive).toContain('previous');
    expect(diffApiSurfaces(spec(BASE), spec('nonsense: true')).inconclusive).toContain('current');
  });
});

describe('checkApi', () => {
  const removed = BASE.replace(/  \/v1\/invoices\/\{id\}:[\s\S]*$/, '');

  it('needs a major for a breaking change', () => {
    const patched = removed.replace('version: 1.2.3', 'version: 1.2.4');
    const check = checkApi(spec(BASE), spec(patched));
    expect(check.verdict).toBe('breaking');
    expect(check.versionCovers).toBe(false);
    expect(formatApiCheck(check)).toContain('needs a major');
  });

  it('passes a breaking change shipped as a major', () => {
    const major = removed.replace('version: 1.2.3', 'version: 2.0.0');
    expect(checkApi(spec(BASE), spec(major)).versionCovers).toBe(true);
  });

  it('does not judge a version that is not semver on both sides', () => {
    const dated = removed.replace('version: 1.2.3', 'version: 2026-08-16');
    const check = checkApi(spec(BASE), spec(dated));
    expect(check.versionCovers).toBeNull();
    expect(formatApiCheck(check)).toContain('not semver');
  });

  it('never renders an inconclusive check as a pass', () => {
    const out = formatApiCheck(checkApi(spec('nope: 1'), spec(BASE)));
    expect(out).toContain('INCONCLUSIVE');
    expect(out).toContain('not a pass');
  });
});
