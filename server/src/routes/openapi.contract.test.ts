/**
 * The OpenAPI document against the routes that actually exist.
 *
 * `docs/api/openapi.json` is the contract the client is written against, and a
 * contract nothing checks is a comment. Client and server disagreeing about a
 * path, a field name or an enum value is the direct cause of four defects in
 * this project's register (ARCH-19), so this test asserts both directions: no
 * route is undocumented, and no documented operation is imaginary.
 *
 * It does not check request or response bodies. That would need the zod
 * schemas and the OpenAPI schemas to be generated from one source, which is
 * the right end state and is not this.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';

// The route table pulls in every controller, service and repository, and with
// them the Firebase Admin SDK. Nothing here calls a route, so the SDK is a
// thirty-second import for no benefit.
vi.mock('../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const { routeTable } = await import('./index.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'api', 'openapi.json');

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

/** An Express router layer, as far as this test cares. */
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

/** `/user/:userId` is `/user/{userId}` in OpenAPI. */
function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** `GET /items/{id}` for every route a router declares. */
function operationsOf(prefix: string, router: Router): string[] {
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;

  return layers.flatMap((layer) => {
    if (!layer.route) return [];

    // Express normalises the root path of a mounted router to '/'.
    const suffix = layer.route.path === '/' ? '' : layer.route.path;
    const full = toOpenApiPath(`${prefix}${suffix}`) || '/';

    return Object.keys(layer.route.methods)
      .filter((method) => method !== '_all')
      .map((method) => `${method.toUpperCase()} ${full}`);
  });
}

function mountedOperations(): string[] {
  return routeTable
    .filter((mount) => !mount.alias)
    .flatMap((mount) => operationsOf(mount.prefix, mount.router))
    .sort();
}

/**
 * A path item holds operations keyed by method, but it may also hold
 * `parameters`, `summary`, `description` or `$ref`. Hoisting the repeated `id`
 * parameter on `/items/{id}` is a natural edit, and treating that key as a
 * method would report `PARAMETERS /items/{id}` as an imaginary route.
 */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function operationsIn(pathItem: Record<string, unknown>): [string, unknown][] {
  return Object.entries(pathItem).filter(([key]) => HTTP_METHODS.includes(key));
}

function documentedOperations(doc: OpenApiDocument): string[] {
  return Object.entries(doc.paths)
    .flatMap(([route, pathItem]) =>
      operationsIn(pathItem).map(([method]) => `${method.toUpperCase()} ${route}`),
    )
    .sort();
}

const document = JSON.parse(fs.readFileSync(DOC_PATH, 'utf8')) as OpenApiDocument;

describe('the OpenAPI document', () => {
  const mounted = mountedOperations();
  const documented = documentedOperations(document);

  it('describes every route the server mounts', () => {
    const undocumented = mounted.filter((operation) => !documented.includes(operation));

    expect(undocumented).toEqual([]);
  });

  it('describes no route the server does not have', () => {
    const imaginary = documented.filter((operation) => !mounted.includes(operation));

    expect(imaginary).toEqual([]);
  });

  it('found routes to compare, so a broken walk cannot pass silently', () => {
    expect(mounted.length).toBeGreaterThan(30);
  });

  it('gives every operation an id, a summary and a tag', () => {
    const incomplete = Object.entries(document.paths).flatMap(([route, pathItem]) =>
      operationsIn(pathItem)
        .filter(([, operation]) => {
          const entry = operation as { operationId?: string; summary?: string; tags?: string[] };

          return !entry.operationId || !entry.summary || !entry.tags?.length;
        })
        .map(([method]) => `${method.toUpperCase()} ${route}`),
    );

    expect(incomplete).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = Object.values(document.paths).flatMap((pathItem) =>
      operationsIn(pathItem).map(
        ([, operation]) => (operation as { operationId: string }).operationId,
      ),
    );

    expect(ids.length).toBe(new Set(ids).size);
  });

  /**
   * The success code is not verified against the running route, which is why
   * the README says the status codes are documentation rather than contract.
   * This catches the cheaper mistake: an operation that describes only failures.
   */
  it('gives every operation a success response', () => {
    const withoutSuccess = Object.entries(document.paths).flatMap(([route, pathItem]) =>
      operationsIn(pathItem)
        .filter(([, operation]) => {
          const responses = (operation as { responses: Record<string, unknown> }).responses ?? {};

          return !Object.keys(responses).some((code) => code.startsWith('2'));
        })
        .map(([method]) => `${method.toUpperCase()} ${route}`),
    );

    expect(withoutSuccess).toEqual([]);
  });

  it('resolves every schema reference', () => {
    const schemas = (document as unknown as { components: { schemas: Record<string, unknown> } })
      .components.schemas;
    const responses = (
      document as unknown as { components: { responses: Record<string, unknown> } }
    ).components.responses;

    const refs =
      JSON.stringify(document).match(/"#\/components\/(schemas|responses)\/[^"]+"/g) ?? [];
    const missing = [...new Set(refs)].filter((ref) => {
      const [, kind, name] = ref.replace(/"/g, '').split('/').slice(1);

      return kind === 'schemas' ? !(name in schemas) : !(name in responses);
    });

    expect(missing).toEqual([]);
  });
});
