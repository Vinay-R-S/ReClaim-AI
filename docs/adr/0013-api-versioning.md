# ADR 0013: A versioned API path, with OpenAPI as the contract

## Status

Accepted, 2026-09-07. Implemented in phase 19.

## Context

There was no API version and no machine-readable description of the HTTP
surface. The consequence is in the defect register four times over: the client
tested for handover states the server has never sent, read a field under a name
the server does not write, and expected an enum member that does not exist.
Each of those is the same failure, which is that the only description of the
contract lived in whichever file happened to implement it.

Two problems, and they are separable:

1. Nothing writes down what the server answers, so the client guesses.
2. Nothing distinguishes one version of the answer from the next, so a
   breaking change has no way to be introduced other than all at once.

## Decision

**Path versioning.** Every route is served under `/api/v1`. The unversioned
`/api` prefix stays, mounted to the same router, so no existing caller breaks;
it sets `Deprecation: true` and a `Link` header naming the versioned successor.

The version is added in exactly two places, `API_VERSION` in `server/src/app.ts`
and `resolveUrl` in `client/src/lib/api.ts`, so call sites keep writing
`/api/items` and a future move is an edit rather than a migration.

One version for the whole surface, not per endpoint. This is a small API with
one first-party client; per-endpoint versioning buys almost nothing and costs a
support matrix.

The version bumps only for a breaking change: removing or renaming an endpoint
or a field, narrowing a type, tightening validation, or changing a status code
a client branches on. Adding an optional field or a new endpoint is not
breaking. When `v2` arrives, `v1` runs beside it.

**Path versioning over the alternatives.** A header (`Accept: application/vnd...`)
is more correct and less usable: it is invisible in a browser, in a log, and in
a curl command somebody pastes into a bug report. A query parameter is easy to
lose. The path is the option that shows up in every place a person looks.

**OpenAPI 3.1 as the contract**, at `docs/api/openapi.json`, and a test that
checks it against the real Express route table in both directions. JSON rather
than YAML so the repository needs no parser dependency to test it.

## Consequences

- Two mounts answer every request, which is a small amount of duplication in
  the router table and a `Deprecation` header for anyone still on the old path.
- The contract cannot drift on **paths or methods** without the test failing,
  and it runs on every push.
- It can still drift on everything else: request bodies, response bodies and
  status codes are compared against nothing, because verifying them means
  either executing every route or generating both the zod schemas and the
  OpenAPI schemas from one source. The second is the right end state. Until it
  exists, those parts of the document are documentation, and the API README
  says so in as many words rather than implying they are checked.
- Client types are still hand-written from `shared/domain.d.ts` rather than
  generated from the document. Generation is the natural next step and would
  close the remaining gap.
- **The client must not deploy before the server.** The browser now asks for
  `/api/v1`, which a server without this change does not serve, so a client-first
  rollout 404s every request until the API catches up. The reverse order is
  safe in both directions, because the server answers the old path too. The two
  packages deploy independently and nothing enforces the ordering, so it is
  written down here and in the deployment document.

## Revisit when

- A second first-party client or a public API appears, at which point
  generating client types from the document stops being optional.
- The unversioned alias has no traffic for a full release cycle, at which point
  it can be removed.
- Two consumers need different shapes of the same resource, which is the
  argument for content negotiation rather than a path bump.
