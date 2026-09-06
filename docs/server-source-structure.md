# Server source structure

What lives where in `server/src`, and why. The layering is
`route -> controller -> service -> repository`: routes only wire middleware,
controllers only translate HTTP, services hold the rules, repositories are the
only code that talks to Firestore.

## Top level

- `index.ts` loads the environment, then imports `app.ts` so nothing reads a
  variable before `dotenv` has run.
- `app.ts` builds the Express app: security headers, CORS, compression, body
  parsers, the rate limiters, the route table and the error handler last.
- `server.ts` starts the listener.
- `config/env.ts` reads and validates every environment variable once. Nothing
  else touches `process.env`.

## `routes/`

Wiring only: path, middleware, controller method. One file per domain.

`auth.ts`, `items.ts`, `matches.ts`, `handover.ts`, `settings.ts`, `credits.ts`,
`cctv.ts`, `users.ts`, `stats.ts`, `ai.ts`.

`handover.ts` is mounted at both `/api/handover` and `/api/handovers` so no
client call had to change when the two old routers were merged.

## `controllers/`

Read the request, call one service, shape the response. No business rules, no
Firestore. One per route file.

## `services/`

The rules.

- `item.service.ts` reporting, approval, rejection and the item lifecycle.
- `match.service.ts` the admin decision on a proposed match, including the
  false-claim penalty.
- `matching/` the pipeline itself: `matching.pipeline.ts` orchestrates,
  `semanticScorer.service.ts` and `visualScorer.service.ts` score, and
  `matching.types.ts` holds the shared shapes.
- `autoMatch.service.ts` runs the pipeline when an item is approved.
- `clarifaiMatch.service.ts` image similarity, optional: without a key it
  scores 0 rather than failing the run.
- `handover.service.ts` the code lifecycle: issue, verify, block, complete.
- `handover.criteria.ts` the distance, day and time rules, kept pure so they
  can be tested without booting firebase-admin.
- `credits.service.ts` the ledger, `credit.account.service.ts` the balance.
- `blockchain.service.ts` the Sepolia record, off unless configured.
- `email.service.ts` Resend with an SMTP fallback, `cloudinary.service.ts`
  images, `ai.service.ts` and `cctv.service.ts` the model calls.
- `audit.service.ts` writes the admin action trail.
- `auth.service.ts`, `user.service.ts`, `userStats.service.ts`,
  `settings.service.ts`, `stats.service.ts`.

## `repositories/`

Every Firestore read and write. Nothing outside this directory imports the
collection references.

`item`, `match`, `handover`, `user`, `credit`, `settings`, `stats`, `audit`.

## `middleware/`

- `auth.middleware.ts` verifies the Firebase ID token and loads the caller.
- `role.middleware.ts` `requireAdmin`, `requireActiveUser`, `requireOwnership`.
- `validation.middleware.ts` runs a zod schema over body, params or query.
- `rateLimit.middleware.ts` the per-surface limiters.
- `errorHandler.middleware.ts` `AppError` and the single error responder: it
  keeps the message and details of a deliberate 4xx and sanitizes everything
  else in production.
- `index.ts` is the barrel the routes import from.

## `schemas/`

One zod schema file per domain, plus `common.schema.ts` for the shared field
builders. Every mutating route validates through one of these.

## `types/`

Server-only types. The document shapes both packages share live in
`shared/domain.d.ts` and are imported from there.

## `utils/`

- `logger.ts` the only logging entry point. It redacts identifiers and drops
  stack traces in production.
- `firebase-admin.ts` initialises the SDK and exports the collections.
- `firestore.ts` cursor pagination and serialization helpers.
- `scoring.ts` the distance and time maths behind matching and handover.
- `llm.ts` provider selection, `html.ts` escaping for email bodies,
  `async.ts` the retry and timeout helpers.

## Tests

Vitest, next to the code they cover (`*.test.ts`). `npm test` runs them;
`npm run test:rules` runs `rules/firestore.rules.test.ts` against the Firestore
emulator.
