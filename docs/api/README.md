# API contract

[`openapi.json`](openapi.json) is the HTTP contract: 40 operations across ten
tags, OpenAPI 3.1.

## Why it exists

Four defects in this project's register are the same defect. The client tested
handover states the server has never sent, read a field under a name the server
does not write, and expected an enum member that does not exist. Each was found
by a user hitting it, because nothing anywhere said what the server actually
returns.

A document alone would not have prevented any of them, because a document
nobody checks drifts within a month. So the document has a test.

## The versioning policy

Every path is served under `/api/v1`.

- The unversioned `/api` prefix is the same router, kept so no caller written
  before the version existed had to change. It answers identically and marks
  its responses `Deprecation: true` with a `Link` header naming the versioned
  successor.
- The client adds the version in one place, `resolveUrl` in `client/src/lib/api.ts`,
  so call sites keep writing `/api/items` and moving to `v2` is one edit.
- One version number for the whole surface, not per endpoint. This is a small
  API with one client; per-endpoint versioning buys nothing and costs a
  combinatorial support matrix.
- The version bumps only for a **breaking** change: removing an endpoint or a
  field, renaming one, narrowing a type, tightening validation, or changing a
  status code a client branches on. Adding an optional field, adding an
  endpoint, or relaxing validation is not breaking.
- When `v2` arrives, `v1` keeps running beside it. Both mount the same way the
  unversioned alias does today.
- A request naming a version that does not exist, `/api/v2/items` today, is a
  plain 404 with no deprecation headers. Pointing it at `/api/v1/v2/items`
  would be worse than saying nothing.
- **Release order: server first.** The browser asks for `/api/v1`, which a
  server without this change does not serve, so shipping the client first 404s
  every request until the API follows. Server first is safe both ways round,
  because the server still answers the unversioned path an older client uses.

Full reasoning in [ADR 0013](../adr/0013-api-versioning.md).

## What the test guarantees

`server/src/routes/openapi.contract.test.ts` runs on every push. It:

- walks the real Express route table and asserts every mounted route is
  documented,
- asserts every documented operation exists,
- asserts every operation has an id, a summary and a tag, and that the ids are
  unique,
- asserts every `$ref` resolves.

What it does **not** check: request bodies, response bodies, status codes, or
which operations are public. Verifying those means either executing every route
or generating the zod schemas and the OpenAPI schemas from one source, and the
second is the right end state.

So read the document in two halves. **Paths and methods are verified** and
cannot drift without CI failing. **Everything else is documentation**: it was
written by reading the controllers and can be wrong in a way nothing here will
catch. When a schema and the code disagree, the code is right.

## Reading it

The file is JSON rather than YAML deliberately: every tool that reads OpenAPI
reads JSON, and it means the repository needs no YAML parser to test it.

Paste it into any OpenAPI viewer, or:

```bash
npx @redocly/cli preview-docs docs/api/openapi.json
```

## Conventions in the document

| Convention | Detail                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth       | `Authorization: Bearer <Firebase ID token>`. An operation with `security: []` is deliberately public                                                   |
| Roles      | Not expressed in OpenAPI, which has no vocabulary for them. The description of each operation says who may call it                                     |
| Errors     | Every error is `{ error: string }`, plus `details[]` on a validation failure. A deliberate 4xx keeps its own message; a 5xx is sanitized in production |
| Timestamps | Firestore timestamps survive JSON as `{ _seconds, _nanoseconds }`. Fields the API converts are `date-time` strings                                     |
| Pagination | Cursor, not offset. A response carries `nextCursor`, null on the last page                                                                             |

## Keeping it honest

Change a route, change this file in the same commit. The test will tell you if
you forget, which is the entire point.
