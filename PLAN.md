# PLAN.md - ReClaim AI Defect Remediation and Hardening

Scope: fix logic bugs, broken components, and security defects across `client/`, `server/`, and `models/`, then land the structural refactor on top. Core workflows (auth and role gating, report lost/found with auto-matching, admin review and handover, CCTV detection, credits) must keep working end to end after every phase.

Baseline verified on `main` at commit `48ff74e`:

| Check        | Command                      | Result             |
| ------------ | ---------------------------- | ------------------ |
| Server build | `cd server && npm run build` | PASS (tsc exit 0)  |
| Client build | `cd client && npm run build` | PASS (vite exit 0) |
| Server tests | `cd server && npm test`      | none exist         |
| Client tests | n/a                          | none exist         |

So nothing here is a compile error. Everything below is a runtime, logic, contract, or security defect that a passing build does not catch.

## How to read this document

The work is split into three tracks.

- Track A, phases 0 to 18, makes the existing system correct, safe, and maintainable. It fixes what is broken and changes no architecture that does not need changing.
- Track B, phases 19 to 33, replaces the parts that cannot scale, adds the intelligence layer properly, and adds the chat and inventory capability. It depends on Track A phases 2, 3, 4, and 14.
- Track C, phases 34 to 38, rebuilds the CCTV subsystem, adds the production toolchain, and produces the artifacts the project is presented with. It depends on Track B phases 20 and 22.

Section map:

| Section | Contents                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| 1       | Master defect register, part one: every Track A finding with a checkbox, severity, evidence, owning phase, and branch |
| 2       | Track A phase plan and the authorization matrix                                                                       |
| 3       | Git protocol. Branches and commits are created by you, never by Claude                                                |
| 4       | Regression matrix, run at the end of every phase                                                                      |
| 5       | Progress log                                                                                                          |
| 6       | Track A open decisions                                                                                                |
| 7       | Target architecture, high level design                                                                                |
| 8       | Matching intelligence redesign, the AIML core                                                                         |
| 9       | AI provider abstraction                                                                                               |
| 10      | Handover redesign, state machine and saga                                                                             |
| 11      | Credit ledger redesign                                                                                                |
| 12      | Match chat with admin supervision                                                                                     |
| 13      | Inventory and custody module, plus the candidate feature backlog                                                      |
| 14      | Security program, mapped to OWASP                                                                                     |
| 15      | Responsiveness, accessibility, and frontend performance                                                               |
| 16      | Low level design, module boundaries, diagrams, contracts, standards                                                   |
| 17      | Architecture decision records                                                                                         |
| 18      | Track B phase plan                                                                                                    |
| 19      | Master defect register, part two: findings from the architecture pass                                                 |
| 20      | Track B open decisions                                                                                                |
| 21      | CCTV subsystem rebuild: assessment, re-identification, ingestion, live mode, UI, CPU targets                          |
| 22      | Production toolchain: packaging, infrastructure as code, CI/CD, observability, testing, runbooks                      |
| 23      | Interview readiness: narrative, numbers, expected questions, demo script                                              |
| 24      | Master defect register, part three: the CCTV subsystem                                                                |
| 25      | Track C phase plan                                                                                                    |
| 26      | Track C open decisions                                                                                                |

Severity key:

| Level | Meaning                                                            |
| ----- | ------------------------------------------------------------------ |
| S1    | Exploitable without authentication, or destroys/corrupts user data |
| S2    | Feature is broken or silently does the wrong thing for real users  |
| S3    | Degraded correctness, performance, or maintainability              |
| S4    | Hygiene, dead code, docs                                           |

Status key: `[ ]` not started, `[~]` in progress, `[x]` done and verified on its branch.

## 1. Master defect register

### 1.1 Access control and authentication (server)

| #   | ID     | Sev | Defect                                                                                                                                                                                                                                                                  | Evidence                                                                                      | Phase | Branch                                        | Status |
| --- | ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----- | --------------------------------------------- | ------ |
| 1   | SEC-01 | S1  | `/api/matches/search`, `/claim`, `/verify` have no auth middleware at all. An anonymous caller can mark any claim valid, trigger handover emails, and apply a -30 credit penalty to any user id.                                                                        | `server/src/routes/matches.ts:18,50,110`                                                      | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 2   | SEC-02 | S1  | The entire `/api/handover` router is public. `GET /history` dumps every handover record including both parties' emails and display names.                                                                                                                               | `server/src/routes/handover.ts:16,41,84`                                                      | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 3   | SEC-03 | S1  | `GET /api/handovers/user/:userId` is public and takes the user id from the path, a direct IDOR onto another user's handover history.                                                                                                                                    | `server/src/routes/handovers.ts:9`                                                            | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 4   | SEC-04 | S1  | `PUT /api/credits/:userId` is public and takes `amount` from the body. Anyone can grant themselves unlimited credits.                                                                                                                                                   | `server/src/routes/credits.ts:49`                                                             | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 5   | SEC-05 | S1  | `POST /api/credits/signup-bonus` is public and takes an arbitrary `userId`.                                                                                                                                                                                             | `server/src/routes/credits.ts:118`                                                            | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 6   | SEC-06 | S1  | `PUT /api/settings` is public. Anyone can flip `testingMode`, `cctvEnabled`, `aiProvider`, and `mapCenter` for the whole platform.                                                                                                                                      | `server/src/routes/settings.ts:61`                                                            | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 7   | SEC-07 | S1  | `POST /api/settings/profile-picture` is public and trusts `userId` from the body. The code comment states "we trust the userId". Anyone can overwrite any user's avatar in Firestore and in Firebase Auth.                                                              | `server/src/routes/settings.ts:102,117`                                                       | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 8   | SEC-08 | S2  | `GET /api/settings/analytics` is documented "admin only (secret)" but has no auth.                                                                                                                                                                                      | `server/src/routes/settings.ts:198`                                                           | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 9   | SEC-09 | S1  | `POST /api/notifications/send-match` and `/send-claim` are public and take `email` plus `itemName` from the body. An open email relay from a verified sending domain, with attacker-controlled text injected raw into the HTML body.                                    | `server/src/routes/notifications.ts:31,57`; `server/src/services/email.ts:159`                | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 10  | SEC-10 | S1  | All `/api/verification/*` routes are public. An anonymous caller can start a verification for any item with any `userId` and `email`, answer its own questions, and drive the item to `Resolved`.                                                                       | `server/src/routes/verification.ts:23`                                                        | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 11  | SEC-11 | S1  | `PUT /api/items/:id`, `PUT /api/items/:id/status`, and `DELETE /api/items/:id` check authentication but never ownership or admin role. Any signed-in user can edit or delete any other user's item.                                                                     | `server/src/routes/items.ts:222,262,306`                                                      | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 12  | SEC-12 | S1  | `PUT /api/items/:id` spreads the raw `updates` object into the Firestore write. Mass assignment: a user can set `status`, `reportedBy`, `matchScore`, `matchedItemId`, `cloudinaryUrls`, and `verifiedAt` on any item.                                                  | `server/src/routes/items.ts:229-233`                                                          | 4     | `feature/reclaim-204-validation-sanitization` | [x]    |
| 13  | SEC-13 | S2  | `/api/cctv/*` requires authentication but not the admin role, so any signed-in user can drive the CCTV pipeline and burn Groq and YOLO quota.                                                                                                                           | `server/src/routes/cctv.ts:11,25,53,152`                                                      | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 14  | SEC-14 | S2  | `POST /api/auth/login-notification` is public with an arbitrary `userId`, so it doubles as a user-existence probe and an email spam trigger.                                                                                                                            | `server/src/routes/auth.ts:15`                                                                | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |
| 15  | SEC-15 | S1  | `validation.middleware.ts` defines the zod schemas plus `sanitizeString` and `sanitizeObject`, and a grep finds zero usages anywhere in `routes/`. Input validation is entirely absent in practice.                                                                     | `server/src/middleware/validation.middleware.ts` (whole file, no importers)                   | 4     | `feature/reclaim-204-validation-sanitization` | [x]    |
| 16  | SEC-19 | S2  | `requireOwnership` grants an admin bypass based on `req.user.role`, which `authMiddleware` reads from Firebase custom claims. The app stores roles in Firestore and never sets custom claims, so the bypass silently never fires, and the helper has no callers anyway. | `server/src/middleware/role.middleware.ts:118`; `server/src/middleware/auth.middleware.ts:44` | 3     | `fix/reclaim-203-auth-hardening`              | [x]    |

### 1.2 Secrets, keys, and platform rules

| #   | ID      | Sev | Defect                                                                                                                                                                                                                                                                                  | Evidence                                                                                                              | Phase | Branch                               | Status |
| --- | ------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------ | ------ |
| 17  | SEC-16  | S1  | Groq and Gemini API keys are read from `import.meta.env` and shipped in the browser bundle. Anyone who loads the site can extract and spend them.                                                                                                                                       | `client/src/services/aiService.ts:53,102,227,289,292,327`                                                             | 5     | `fix/reclaim-205-secrets-and-rules`  | [x]    |
| 18  | SEC-16b | S2  | The server itself falls back to `VITE_*` key names, which encourages putting server keys into client env files.                                                                                                                                                                         | `server/src/utils/llm.ts:37,94,151,337-343`; `server/src/routes/cctv.ts:79,157`; `server/src/services/email.ts:20-21` | 5     | `fix/reclaim-205-secrets-and-rules`  | [x]    |
| 19  | SEC-17  | S1  | No `firestore.rules` or `firestore.indexes.json` anywhere in the repo, while the client writes `users/{uid}` directly including `role: "user"`, `status: "active"`, and `credits: 10`. Without server-side rules a user can self-assign `role: "admin"` or an arbitrary credit balance. | `client/src/context/AuthContext.tsx:157-172,255-275`; no rules file in tree                                           | 5     | `fix/reclaim-205-secrets-and-rules`  | [x]    |
| 20  | SEC-18  | S2  | Handover codes are generated with `Math.random()` and stored as an unsalted SHA-256 of a 6-digit number. A leaked `codeHash` is reversible by brute force in under a second.                                                                                                            | `server/src/services/handover.service.ts:70-77`                                                                       | 7     | `fix/reclaim-207-handover-integrity` | [ ]    |
| 21  | SEC-20  | S1  | The Flask YOLO service runs `app.run(host='0.0.0.0', debug=True)`. The Werkzeug debugger is remote code execution if the port is reachable. It also has wide-open CORS and no authentication.                                                                                           | `models/app.py:10,214`                                                                                                | 5     | `fix/reclaim-205-secrets-and-rules`  | [x]    |
| 22  | SEC-21  | S3  | The Firebase web config is hardcoded as literal fallbacks in source rather than required from env, and `VITE_ADMIN_EMAIL` is compiled into the bundle for admin filtering.                                                                                                              | `client/src/lib/firebase.ts:12-19`; `client/src/services/userService.ts:33`                                           | 5     | `fix/reclaim-205-secrets-and-rules`  | [x]    |

### 1.3 Components that do not work

| #   | ID     | Sev | Defect                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                  | Phase | Branch                                                              | Status |
| --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------- | ------ |
| 23  | UI-01  | S1  | The admin Pending Approvals screen has no approve or reject action. Its only button is Refresh. The documented admin review and approval workflow does not exist in the UI.                                                                                                                                                                                                     | `client/src/pages/admin/PendingApprovalsPage.tsx:97` (only `onClick` in the file)                                                                                                         | 10    | `feature/reclaim-210-admin-review-workflow`                         | [ ]    |
| 24  | UI-02  | S1  | The admin Matches screen says "Review and verify item matches" but has no verify or reject action, and no code anywhere in `client/` calls `POST /api/matches/verify`. The admin verification path is unreachable from the UI.                                                                                                                                                  | `client/src/pages/admin/MatchesPage.tsx:74,87`; grep for `matches/verify` in `client/` returns nothing                                                                                    | 10    | `feature/reclaim-210-admin-review-workflow`                         | [ ]    |
| 25  | UI-03  | S2  | CCTV register-as-found loses the detected image. `AddItemModal` seeds `imagePreviews` from `initialData.imageUrl`, but `handleSubmit` only uploads from `imageFiles`, which stays empty. The admin sees a preview and the created item has zero images.                                                                                                                         | `client/src/components/admin/AddItemModal.tsx:41,132-137,149`; `client/src/pages/admin/CCTVIntelligence.tsx:292,320,830`                                                                  | 11    | `fix/reclaim-211-cctv-pipeline`                                     | [ ]    |
| 26  | UI-04  | S2  | CCTV-registered items are hardcoded to `location: "Admin Office (CCTV)"` with no coordinates and default to "now" for the date, so they score 0 on location and sit at the edge of the time window. In practice CCTV items never match.                                                                                                                                         | `client/src/pages/admin/CCTVIntelligence.tsx:293,303,321`; `server/src/utils/scoring.ts:246-286`                                                                                          | 11    | `fix/reclaim-211-cctv-pipeline`                                     | [ ]    |
| 27  | UI-05  | S2  | The verify page reads `result.attemptsRemaining`; the server returns `attemptsLeft`. The attempts-left counter never updates after a wrong code.                                                                                                                                                                                                                                | `client/src/pages/VerifyHandoverPage.tsx:110`; `server/src/services/handover.service.ts:236`                                                                                              | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 28  | UI-06  | S2  | The verify page checks `statusData.status === "completed"`; `getHandoverStatus` returns the code-document status, which is `pending`, `verified`, or `blocked`. The already-completed state can never render, so a finished handover still shows a live code form.                                                                                                              | `client/src/pages/VerifyHandoverPage.tsx:31`; `server/src/services/handover.service.ts:301-310`                                                                                           | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 29  | UI-07  | S2  | The report form writes `collectionLocation`, the server persists `collectionLocation`, and every consumer reads `collectionPoint`. The handover email to the owner therefore shows the found-at location instead of the collection point, and the admin Handovers screen never shows one.                                                                                       | `client/src/components/user/ReportItemModal.tsx:235`; `server/src/routes/items.ts:150-152`; `server/src/services/handover.service.ts:174`; `client/src/pages/admin/HandoversPage.tsx:374` | 9     | `fix/reclaim-209-item-lifecycle`                                    | [ ]    |
| 30  | UI-07b | S2  | `collectionCoordinates` is collected by the report form and sent to the server, which drops it on the floor when building the item document.                                                                                                                                                                                                                                    | `client/src/components/user/ReportItemModal.tsx:236-238`; `server/src/routes/items.ts:127-160`                                                                                            | 9     | `fix/reclaim-209-item-lifecycle`                                    | [ ]    |
| 31  | UI-08  | S2  | `getUserItemsCount` filters items on `userId` and `userEmail`, but items are stored with `reportedBy` and `reportedByEmail`. It always returns 0.                                                                                                                                                                                                                               | `client/src/services/userService.ts:87-108`                                                                                                                                               | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 32  | UI-09  | S2  | The header credit badge caches in `sessionStorage` for 5 minutes and refreshes only on a `creditUpdate` custom event that nothing in the codebase ever dispatches. After a handover awards credits, the badge stays stale.                                                                                                                                                      | `client/src/components/layout/UserLayout.tsx:70-100`; grep for `dispatchEvent` in `client/` returns nothing                                                                               | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 33  | UI-10  | S2  | `App.tsx` has no catch-all route. Any unknown URL renders an empty page with no 404 and no redirect.                                                                                                                                                                                                                                                                            | `client/src/App.tsx:71-130`                                                                                                                                                               | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 34  | UI-11  | S2  | The blocked-account message never appears. `fetchUserRole` sets `blockedError` then calls `firebaseSignOut`; the `onAuthStateChanged` null branch fires immediately after and runs `setBlockedError(null)`.                                                                                                                                                                     | `client/src/context/AuthContext.tsx:96,116-127`                                                                                                                                           | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 35  | UI-12  | S3  | `ProtectedRoute` unconditionally redirects any admin away from every `/app/*` route, so an admin cannot open their own handovers, reports, or profile.                                                                                                                                                                                                                          | `client/src/components/auth/ProtectedRoute.tsx:40-42`                                                                                                                                     | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 36  | UI-13  | S2  | Manual match search accepts `imageBase64`, but `findMatchesForLostItem` and `findMatchesForFoundItem` only read `cloudinaryUrls`, which is never populated on that path. Image similarity is always 0 for manual search.                                                                                                                                                        | `server/src/routes/matches.ts:19,33`; `server/src/services/matching.ts:150,247`                                                                                                           | 8     | `refactor/reclaim-208-matching-pipeline`                            | [ ]    |
| 37  | UI-14  | S3  | Dead endpoints with no caller anywhere in `client/`: `/api/matches/search`, `/claim`, `/verify`, `/item/:itemId`, `/user/:userId`, every `/api/verification/*`, every `/api/notifications/*`, `POST /api/handover/initiate`, `GET /api/credits/history/:userId`, `PUT /api/credits/:userId`. Each is also unauthenticated, so they are attack surface for features nobody uses. | grep across `client/src` for each path                                                                                                                                                    | 3, 18 | `fix/reclaim-203-auth-hardening`, `chore/reclaim-218-deadcode-docs` | [ ]    |
| 38  | UI-15  | S2  | The report modal base64-encodes up to 5 images as full data URLs with no compression and posts them as JSON against a 10 MB body limit. Ordinary phone photos produce a 413 and the report silently fails. Note that `itemService.uploadItemImage` already implements compression and this path does not use it.                                                                | `client/src/components/user/ReportItemModal.tsx:208-213,275-283`; `server/src/app.ts:89`; `client/src/services/itemService.ts:170-215`                                                    | 12    | `fix/reclaim-212-client-contract-fixes`                             | [ ]    |
| 39  | UI-16  | S3  | All error and validation feedback in the report and add-item modals uses `window.alert`, including for expected states like a missing field.                                                                                                                                                                                                                                    | `client/src/components/user/ReportItemModal.tsx:190,196,201,267`; `client/src/components/admin/AddItemModal.tsx:113,126,181`                                                              | 15    | `refactor/reclaim-215-client-components`                            | [ ]    |

### 1.4 Logic and data-model defects

| #   | ID      | Sev | Defect                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                  | Phase | Branch                                        | Status |
| --- | ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------- | ------ |
| 40  | LOG-01  | S1  | Two divergent credit stores. `services/credits.ts` writes `users/{uid}.credits`, `GET /api/credits/:userId` reads `users/{uid}.credits`, and `PUT /api/credits/:userId` writes a completely different `credits/{uid}` document. Manual credit adjustments land in a collection that nothing reads.                      | `server/src/services/credits.ts:44-46`; `server/src/routes/credits.ts:30,71,84`                                                                           | 6     | `fix/reclaim-206-credits-single-source`       | [ ]    |
| 41  | LOG-01b | S2  | Three different sources decide the starting balance: `AuthContext` writes `credits: 10` client-side, `initializeCredits()` sets it to `0`, and `/signup-bonus` only logs a transaction row without changing any balance.                                                                                                | `client/src/context/AuthContext.tsx:163,266`; `server/src/services/credits.ts:170-177`; `server/src/routes/credits.ts:118-145`                            | 6     | `fix/reclaim-206-credits-single-source`       | [ ]    |
| 42  | LOG-01c | S3  | `PUT /api/credits/:userId` seeds a missing balance to `DEFAULT_CREDITS = 10` but an existing document to `data?.credits \|\| 0`, so the same operation behaves differently depending on whether the document exists.                                                                                                    | `server/src/routes/credits.ts:11,63-69`                                                                                                                   | 6     | `fix/reclaim-206-credits-single-source`       | [ ]    |
| 43  | LOG-02  | S2  | `PUT /api/items/:id/status` writes `matchedUserId` unconditionally. When the caller omits it the value is `undefined`, Firestore rejects undefined values, and the request 500s.                                                                                                                                        | `server/src/routes/items.ts:270-274`                                                                                                                      | 4     | `feature/reclaim-204-validation-sanitization` | [x]    |
| 44  | LOG-03  | S1  | `triggerAutoMatching` is awaited inside the create-item request and rethrows on failure, so a successfully created item returns a 500 to the client. The user sees "Failed to submit" for an item that exists.                                                                                                          | `server/src/routes/items.ts:180-201`; `server/src/services/autoMatch.service.ts:349-352`                                                                  | 9     | `fix/reclaim-209-item-lifecycle`              | [ ]    |
| 45  | LOG-04  | S1  | Auto-match calls `initiateHandover` inside the candidate loop, so one report above threshold against N candidates creates N handover sessions and sends 2N emails, while only the single best candidate is later marked `Matched`.                                                                                      | `server/src/services/autoMatch.service.ts:288-300`                                                                                                        | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 46  | LOG-05  | S3  | Dead branch: the second `if (finalScore > highestScore)` inside the match block can never be true, because `highestScore` was already raised to `finalScore` a few lines above.                                                                                                                                         | `server/src/services/autoMatch.service.ts:250-254,303-307`                                                                                                | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 47  | LOG-06  | S2  | The missing-image normalization only runs when both sides have zero images. When Clarifai is unconfigured but images exist, `hasImages` is true, `imageScore` is 0, and no normalization happens, so every score is depressed by the full 15-point image weight and matching effectively stops.                         | `server/src/services/autoMatch.service.ts:224-243`; `server/src/services/clarifaiMatch.service.ts:47-51`                                                  | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 48  | LOG-07  | S3  | `MATCH_CONFIG.WEIGHTS.tags` and `.description` are both `0`, so `calculateTagScore` and `calculateDescriptionScore` always return `0`. They are still exported, still documented as 30 and 20 points in the file header, and still imported by name.                                                                    | `server/src/utils/scoring.ts:1-12,19-21,108-166`                                                                                                          | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 49  | LOG-08  | S3  | `calculateCategoryScore` returns `MATCH_CONFIG.WEIGHTS.category \|\| 5`. Because the weight is `0` it returns `5`, injecting points the weight table says do not exist and breaking the weights-sum-to-100 invariant.                                                                                                   | `server/src/utils/scoring.ts:174-182`                                                                                                                     | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 50  | LOG-09  | S2  | The `minCommonTags >= 1` pre-filter runs before any semantic scoring, so two genuinely matching items whose tags happen to be disjoint are dropped before the LLM ever sees them. The tag fallback only splits the item name, so "iPhone 13" against "Apple phone" is filtered out.                                     | `server/src/services/autoMatch.service.ts:174-187`; `server/src/utils/scoring.ts:92-105`                                                                  | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 51  | LOG-10  | S2  | `validateHandoverCriteria` is called, its result logged as a warning, and then ignored ("proceeding anyway"), so the documented strict 600 m, same-day, plus or minus 2 hour handover rules are never enforced. Its rejection text also says "max 200m allowed" while `LOCATION_RADIUS_KM` is `0.6`.                    | `server/src/services/handover.service.ts:19-66,116-120`                                                                                                   | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 52  | LOG-10b | S3  | `validateHandoverCriteria` contains an `else` block whose entire body is commented-out reasoning and does nothing.                                                                                                                                                                                                      | `server/src/services/handover.service.ts:33-42`                                                                                                           | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 53  | LOG-11  | S1  | `initiateHandover` overwrites any existing handover-code document for the match with `attempts: 0, status: 'pending'`. A handover blocked for too many failed attempts is silently unblocked and re-issued by any re-trigger.                                                                                           | `server/src/services/handover.service.ts:139-148`                                                                                                         | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 54  | LOG-12  | S1  | `blockUserAndReset` blocks the lost person's entire account when the found person mistypes the code three times. The party punished is not the party typing, so a finder can permanently block an owner's account on purpose.                                                                                           | `server/src/services/handover.service.ts:428-450`                                                                                                         | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 55  | LOG-13  | S2  | The failed-attempt counter is a read-then-write with no transaction, so concurrent requests all read the same `attempts` value and the 3-attempt cap can be bypassed by parallel guessing.                                                                                                                              | `server/src/services/handover.service.ts:222-243`                                                                                                         | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 56  | LOG-14  | S2  | `completeHandover` batches an `update` on both item documents and a `delete` on `matches/{matchId}` with no existence checks. When the match was synthesized by `/api/matches/verify` with `'unknown'` ids, or an item was deleted, the whole batch fails and the handover is lost after the code was already accepted. | `server/src/services/handover.service.ts:255-350`; `server/src/routes/matches.ts:143-155`                                                                 | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 57  | LOG-15  | S2  | Both `toDate` helpers fall back to `new Date()` when the value is missing, so an item with no date silently passes the same-day check and the time-window filter instead of being rejected.                                                                                                                             | `server/src/services/handover.service.ts:82-88`; `server/src/services/autoMatch.service.ts:28-33`                                                         | 7     | `fix/reclaim-207-handover-integrity`          | [ ]    |
| 58  | LOG-16  | S2  | Two competing claim flows with different terminal states for the same real-world event: the verification agent sets an item to `Resolved`, the handover flow sets it to `Claimed`. Dashboards count only `Claimed`, so anything resolved through verification disappears from the metrics.                              | `server/src/services/verificationAgent.ts:277-283`; `server/src/services/handover.service.ts:339-341`; `client/src/pages/admin/MainDashboard.tsx:625-640` | 9     | `fix/reclaim-209-item-lifecycle`              | [ ]    |
| 59  | LOG-17  | S2  | `submitVerificationAnswer` accepts any `questionIndex`, allows re-answering the same question and answering out of order, and rewrites the whole `questions` array, so concurrent submissions lose answers. There is also no attempt cap.                                                                               | `server/src/services/verificationAgent.ts:197-266`                                                                                                        | 9     | `fix/reclaim-209-item-lifecycle`              | [ ]    |
| 60  | LOG-18  | S2  | `updateCredits` uses `.update()`, which throws when the user document does not exist. The error is caught and returns `success: false`, so the credit award is silently dropped.                                                                                                                                        | `server/src/services/credits.ts:44-46,76-79`                                                                                                              | 6     | `fix/reclaim-206-credits-single-source`       | [ ]    |
| 61  | LOG-18b | S4  | `reason.toLowerCase().replace(/_/g, '_')` is a no-op replace cast through `any`.                                                                                                                                                                                                                                        | `server/src/services/credits.ts:57`                                                                                                                       | 6     | `fix/reclaim-206-credits-single-source`       | [ ]    |
| 62  | LOG-20  | S2  | `signUpWithEmail` only creates the user document and posts the signup bonus inside `if (displayName && result.user)`. Without a display name it races `saveUserToFirestore` from `onAuthStateChanged`, which can duplicate the bonus transaction or drop the display name.                                              | `client/src/context/AuthContext.tsx:243-296`                                                                                                              | 12    | `fix/reclaim-212-client-contract-fixes`       | [ ]    |
| 63  | LOG-21  | S2  | `settings.ts` declares `AIProvider` without `grok_only` and `grok_with_fallback`, which `llm.ts` supports and switches on. Selecting Grok is rejected by `PUT /api/settings` with a 400.                                                                                                                                | `server/src/routes/settings.ts:11,64-67`; `server/src/utils/llm.ts:206`                                                                                   | 9     | `fix/reclaim-209-item-lifecycle`              | [ ]    |
| 64  | LOG-22  | S2  | `POST /api/matches/verify` initiates the handover but never advances the item status, writing only `verificationConfidence`, `verifiedBy`, and `verifiedAt`. The item stays visible as available.                                                                                                                       | `server/src/routes/matches.ts:170-175`                                                                                                                    | 10    | `feature/reclaim-210-admin-review-workflow`   | [ ]    |
| 65  | LOG-22b | S3  | The same handler builds its match lookup with `item.matchedItemId \|\| 'unknown'` and, when no match is found, writes a match document containing the literal string `'unknown'` as an item id. That poisoned id then flows into `initiateHandover` and `completeHandover`.                                             | `server/src/routes/matches.ts:121-155`                                                                                                                    | 10    | `feature/reclaim-210-admin-review-workflow`   | [ ]    |
| 66  | LOG-23  | S4  | `ConversationState` lists `'complete'` twice in the union, and `SAFETY_LIMITS` still declares `MATCH_THRESHOLD_PERCENT: 75`, `LOCATION_RADIUS_KM: 10`, and `TIME_WINDOW_HOURS: 72`, all of which contradict the live `MATCH_CONFIG` values of 55, 15, and 96.                                                           | `server/src/types/index.ts:96-108,204-212`; `server/src/utils/scoring.ts:16-54`                                                                           | 18    | `chore/reclaim-218-deadcode-docs`             | [ ]    |
| 67  | LOG-24  | S3  | The Flask analyzer reports `framesWithTarget: len(keyframes)` after truncating `keyframes` to 10, so the stat is capped at 10 regardless of the real count.                                                                                                                                                             | `models/app.py:191-201`                                                                                                                                   | 11    | `fix/reclaim-211-cctv-pipeline`               | [ ]    |
| 68  | LOG-25  | S3  | Auto-match checks for an existing match only in the `(lostItemId, foundItemId)` orientation, so the reversed pair can create a duplicate match record.                                                                                                                                                                  | `server/src/services/autoMatch.service.ts:265-270`                                                                                                        | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 69  | LOG-26  | S3  | Auto-match writes `matchScore` onto the item even when the best score is below threshold, so the UI shows a match percentage for an item that has no match.                                                                                                                                                             | `server/src/services/autoMatch.service.ts:314-320`                                                                                                        | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 70  | LOG-27  | S3  | `items.ts` never forwards `cloudinaryUrls` into `triggerAutoMatching`, only `imageUrl`, so multi-image comparison degrades to a single image on the create path.                                                                                                                                                        | `server/src/routes/items.ts:183-195`                                                                                                                      | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 71  | LOG-28  | S3  | The `POST /api/items` response returns the raw `newItem` object containing unresolved `FieldValue.serverTimestamp()` sentinels, which serialize to `{}` in JSON, so any client rendering `createdAt` from the create response gets an invalid date.                                                                     | `server/src/routes/items.ts:203-207`                                                                                                                      | 9     | `fix/reclaim-209-item-lifecycle`              | [ ]    |

### 1.5 Query, performance, and scale

| #   | ID      | Sev | Defect                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                          | Phase | Branch                                        | Status |
| --- | ------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------- | ------ |
| 72  | PERF-01 | S2  | `GET /api/items` combines `orderBy('createdAt','desc')` with a `where` on `type`, `status`, or `reportedBy`, which needs composite indexes that are not in the repo. The `ProfilePage` `?reportedBy=` call and `GET /api/items/user/:userId` fail against a fresh project.                   | `server/src/routes/items.ts:26-37,83-88`; `client/src/pages/user/ProfilePage.tsx:85-86`                                                                                                                                           | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 73  | PERF-02 | S3  | `limit` is parsed with `parseInt` and no validation, so `?limit=abc` produces `limit(NaN)` and throws.                                                                                                                                                                                       | `server/src/routes/items.ts:38`                                                                                                                                                                                                   | 4     | `feature/reclaim-204-validation-sanitization` | [x]    |
| 74  | PERF-03 | S2  | `GET /api/handovers/user/:userId` loads every completed handover in the collection and filters in memory.                                                                                                                                                                                    | `server/src/routes/handovers.ts:19-35`                                                                                                                                                                                            | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 75  | PERF-04 | S2  | `GET /api/matches/user/:userId` re-runs the full LLM matching pipeline for every one of the user's lost items on every request.                                                                                                                                                              | `server/src/routes/matches.ts:283-305`                                                                                                                                                                                            | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 76  | PERF-05 | S1  | `findMatchesForLostItem` and `findMatchesForFoundItem` fire one LLM call per candidate through `Promise.all` with no concurrency cap, retry, or timeout, on an unauthenticated route. One anonymous request against a large item set is an unbounded LLM bill.                               | `server/src/services/matching.ts:129-190,214-275`; `server/src/routes/matches.ts:18`                                                                                                                                              | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 77  | PERF-06 | S2  | No outbound request has a timeout or abort signal: Groq, Gemini, Clarifai, and the YOLO proxy. The Clarifai call passes a `timeout` property that native `fetch` ignores, behind a `@ts-ignore` left over from `node-fetch`.                                                                 | `server/src/utils/llm.ts:65,122,185`; `server/src/services/clarifaiMatch.service.ts:170-172`; `server/src/routes/cctv.ts:13,31,64`                                                                                                | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 78  | PERF-07 | S2  | Seven admin screens read the entire `items` collection from the client with `getItems()`, and `MainDashboard` refetches it plus all matches and all handovers every 30 seconds.                                                                                                              | `client/src/pages/admin/{MainDashboard,MatchesPage,PendingApprovalsPage,UsersManagement,AdminDashboard}.tsx`, `client/src/components/admin/{ItemHeatmap,UserDetailModal}.tsx`; `client/src/pages/admin/MainDashboard.tsx:606-610` | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 79  | PERF-08 | S3  | `getAuthToken` calls `getIdToken(true)`, forcing a network token refresh on every single API call.                                                                                                                                                                                           | `client/src/lib/authApi.ts:22`                                                                                                                                                                                                    | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 80  | PERF-09 | S3  | `apiLimiter` allows 10,000 requests per 15 minutes, which is not a limit in practice, while `authLimiter` allows only 5 per 15 minutes per IP and is applied to `/api/auth/login-notification`, which fires on every sign-in. Users behind shared NAT get locked out of login notifications. | `server/src/middleware/rateLimit.middleware.ts:22-32`; `server/src/app.ts:77`                                                                                                                                                     | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 81  | PERF-10 | S3  | `getCreditHistory` fetches `limit * 2` rows and sorts in memory, with a comment explaining it is dodging a missing composite index.                                                                                                                                                          | `server/src/services/credits.ts:129-155`                                                                                                                                                                                          | 16    | `perf/reclaim-216-performance`                | [ ]    |
| 82  | PERF-11 | S3  | Every `callLLM` may hit Firestore to read the provider setting on a 60-second cache, so a matching run against N candidates can add N settings reads on a cold cache.                                                                                                                        | `server/src/utils/llm.ts:214-231`                                                                                                                                                                                                 | 8     | `refactor/reclaim-208-matching-pipeline`      | [ ]    |
| 83  | PERF-12 | S3  | `exceljs` ships a 936 kB (271 kB gzipped) vendor chunk, the largest asset in the build, for an export feature.                                                                                                                                                                               | client build output: `vendor-excel-*.js 936.56 kB`                                                                                                                                                                                | 16    | `perf/reclaim-216-performance`                | [ ]    |

### 1.6 Architecture, duplication, and hygiene

| #   | ID      | Sev | Defect                                                                                                                                                                                                                                                                                                               | Evidence                                                                                                                                 | Phase | Branch                                      | Status |
| --- | ------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------- | ------ |
| 84  | ARCH-01 | S3  | No controller, service, or repository layering. All business logic lives in Express route handlers with direct Firestore access.                                                                                                                                                                                     | `server/src/routes/*.ts`                                                                                                                 | 14    | `refactor/reclaim-214-server-layering`      | [ ]    |
| 85  | ARCH-02 | S3  | `errorHandler`, `asyncHandler`, `AppError`, and `logSecurityEvent` are implemented and exported, but every route hand-rolls `try/catch` plus a raw `res.status().json()`, so the central error path is never exercised.                                                                                              | `server/src/middleware/errorHandler.middleware.ts`; no route imports `asyncHandler` or `AppError`                                        | 2     | `refactor/reclaim-202-server-foundation`    | [ ]    |
| 86  | ARCH-03 | S3  | `calculateSemanticScore`, `calculateImageScore`, and `toDate` are duplicated near-verbatim between `matching.ts` and `autoMatch.service.ts`, with drifted prompts and thresholds.                                                                                                                                    | `server/src/services/matching.ts:22-100`; `server/src/services/autoMatch.service.ts:28-117`                                              | 8     | `refactor/reclaim-208-matching-pipeline`    | [ ]    |
| 87  | ARCH-04 | S3  | Two routers for one domain, `routes/handover.ts` and `routes/handovers.ts`, mounted at `/api/handover` and `/api/handovers`.                                                                                                                                                                                         | `server/src/app.ts:106-107`                                                                                                              | 14    | `refactor/reclaim-214-server-layering`      | [ ]    |
| 88  | ARCH-05 | S4  | Dead modules kept in the build: `utils/safety.ts` (zero importers, the chat feature was removed), `utils/embeddings.ts` (its only consumer builds a string and logs it), and the whole chat and conversation type block.                                                                                             | `server/src/utils/safety.ts`; `server/src/utils/embeddings.ts`; `server/src/routes/items.ts:163-171`; `server/src/types/index.ts:75-190` | 18    | `chore/reclaim-218-deadcode-docs`           | [ ]    |
| 89  | ARCH-06 | S4  | Inconsistent service file naming: `credits.ts`, `email.ts`, `cloudinary.ts`, `matching.ts`, and `userStats.ts` alongside `handover.service.ts`, `autoMatch.service.ts`, and `blockchain.service.ts`.                                                                                                                 | `server/src/services/`                                                                                                                   | 14    | `refactor/reclaim-214-server-layering`      | [ ]    |
| 90  | ARCH-07 | S2  | `console.*` throughout the server, including recipient email addresses, user ids, item names and descriptions, and full LLM prompts. No logger, no redaction, no levels.                                                                                                                                             | `server/src/routes/auth.ts:37-56`; `server/src/services/email.ts:50,84`; `server/src/services/autoMatch.service.ts` (throughout)         | 2     | `refactor/reclaim-202-server-foundation`    | [ ]    |
| 91  | ARCH-08 | S3  | `Item` and `ItemInput` are declared independently on client and server and have already drifted: the client requires `status` and has `contactEmail`, the server has `reporterEmail`, `collectionLocation`, and `embedding`.                                                                                         | `server/src/types/index.ts:31-73`; `client/src/services/itemService.ts:22-63`                                                            | 13    | `refactor/reclaim-213-client-service-layer` | [ ]    |
| 92  | ARCH-09 | S2  | `itemService.ts` dual-writes. `addItem`, `updateItem`, and `deleteItem` write directly to Firestore from the browser, bypassing Cloudinary upload, auto-matching, user item counts, and credits, while `updateItemViaApi` and `deleteItemViaApi` go through the server. Two write paths with different side effects. | `client/src/services/itemService.ts:94-140` against `:143-170`                                                                           | 13    | `refactor/reclaim-213-client-service-layer` | [ ]    |
| 93  | ARCH-10 | S2  | `matchService.ts` and `handoverService.ts` use bare `fetch` with no `Authorization` header, so the endpoints they call cannot be secured without changing these files in the same phase.                                                                                                                             | `client/src/services/matchService.ts:21,36`; `client/src/services/handoverService.ts:22,41,52`                                           | 3     | `fix/reclaim-203-auth-hardening`            | [x]    |
| 94  | ARCH-11 | S3  | No environment validation at boot. Missing keys surface as runtime failures deep inside request handlers, and `index.ts` logs whether the Firebase key was loaded.                                                                                                                                                   | `server/src/index.ts:13`; `server/src/utils/firebase-admin.ts:12-36`                                                                     | 2     | `refactor/reclaim-202-server-foundation`    | [ ]    |
| 95  | ARCH-12 | S3  | `app.listen` lives inside `app.ts`, which also does `export default app`, so the app cannot be imported for tests or a serverless handler without starting a listener.                                                                                                                                               | `server/src/app.ts:119-125`                                                                                                              | 2     | `refactor/reclaim-202-server-foundation`    | [ ]    |
| 96  | ARCH-13 | S3  | Monolithic components: `ReportItemModal` 875, `MainDashboard` 865, `CCTVIntelligence` 836, `UsersManagement` 817, `AdminSettings` 725, `AddItemModal` 675, `LandingPage` 569, `ItemDetailModal` 562 lines.                                                                                                           | `client/src/` line counts                                                                                                                | 15    | `refactor/reclaim-215-client-components`    | [ ]    |
| 97  | ARCH-14 | S3  | No tests anywhere, despite `vitest` being installed and `npm test` wired on the server. No CI workflow.                                                                                                                                                                                                              | `server/package.json:11`; no `.github/` in tree                                                                                          | 17    | `test/reclaim-217-tests-and-ci`             | [ ]    |
| 98  | ARCH-15 | S4  | Scrap files `client/src/d.md` and `server/src/d.md` are committed, and `.gitignore` lists `node_modules` twice.                                                                                                                                                                                                      | `client/src/d.md`; `server/src/d.md`; `.gitignore`                                                                                       | 1     | `chore/reclaim-201-hygiene-and-config`      | [x]    |
| 99  | ARCH-16 | S2  | `models/requirements.txt` is UTF-16 encoded with a BOM. `pip install -r requirements.txt` fails to parse it on a standard toolchain.                                                                                                                                                                                 | `models/requirements.txt` (null-byte interleaved bytes)                                                                                  | 1     | `chore/reclaim-201-hygiene-and-config`      | [x]    |
| 100 | ARCH-17 | S4  | `import { initiateHandover }` sits in the middle of `routes/matches.ts` between two handlers, and `awardMatchCredits` and `sendClaimConfirmation` are imported at the top but never used.                                                                                                                            | `server/src/routes/matches.ts:6-8,99`                                                                                                    | 18    | `chore/reclaim-218-deadcode-docs`           | [ ]    |
| 101 | ARCH-18 | S4  | `models/app.py` loads `yolo11m.pt` while the project README and directory docs describe YOLOv8.                                                                                                                                                                                                                      | `models/app.py:13`; `README.md`                                                                                                          | 18    | `chore/reclaim-218-deadcode-docs`           | [ ]    |

Totals: 101 findings. S1: 21. S2: 40. S3: 30. S4: 10.

## 2. Phase plan

Ordering rule: foundations before behavior, security before refactor, contracts before UI, decomposition last. Every phase is one branch cut from `develop`, and every phase ends with both builds green and the regression matrix in section 4 re-run.

### Phase 0 - Baseline and safety net

Branch: `chore/reclaim-200-baseline`

- Record the verified baseline in this file (done: both builds pass at `48ff74e`).
- Create `develop` from `main` if it does not exist yet.
- Capture a Firestore export, or at minimum note the current document shapes for `users`, `items`, `matches`, `matchHistory`, `handovers`, `handoverCodes`, `credits`, `creditTransactions`, `settings`, and `verifications`. Several later phases change document shapes and need a rollback reference.
- No code change.

Exit: `develop` exists, baseline recorded.

### Phase 1 - Repo hygiene and configuration

Branch: `chore/reclaim-201-hygiene-and-config`

Fixes: ARCH-15, ARCH-16.

- Move `client/src/d.md` and `server/src/d.md` into `docs/` after confirming no importer references them. They are real structure documentation rather than scrap, so they are preserved rather than deleted, and will need regenerating once phases 14 and 15 restructure both trees.
- De-duplicate and tidy `.gitignore`.
- Re-encode `models/requirements.txt` as UTF-8 and verify `pip install -r models/requirements.txt` parses.
- Add `.editorconfig` and a Prettier config aligned to the Airbnb rules already in `client/eslint.config.js`. Add an ESLint config to `server/` so both packages lint.
- Add `server/.env.example` and `client/.env.example` listing every variable the code reads. The client file must document `VITE_GROQ_API_KEY`, `VITE_GEMINI_API_KEY`, and `VITE_ADMIN_EMAIL` as currently required but deprecated, because they are live reads until phase 5 removes them. Omitting them produces a build with silently degraded AI paths.

Added during the phase, not in the original scope:

- `.gitattributes` normalizing line endings, so identical files stop diffing as fully rewritten across platforms. `package-lock.json` is marked `linguist-generated` but deliberately not `-diff`, so dependency changes stay auditable in `git diff`.
- Per-package `.prettierignore` files. Prettier walks up the tree for its config but resolves the ignore file only against the working directory, so a root-only ignore file is not seen by scripts that run from `client/` or `server/`.
- Both ESLint configs pinned to the same major, and their shared rules kept identical, so the same line cannot pass in one workspace and fail in the other.

Exit: both builds pass, both linters exit 0, `pip install -r models/requirements.txt` parses, no behavior change.

Outstanding, then resolved at the start of phase 2: `npm run format:check` failed on 97 files (39 in `server/`, 58 in `client/`) because the Prettier config contradicts the existing double-quoted style and no formatting pass had been run. The pass ran across both packages as the first commit of `refactor/reclaim-202-server-foundation`. It produces a content change in 92 of those files; the other five differ only in bytes that git's line-ending normalization already collapses, so they never appear in `git diff`. `format:check` now exits 0 in `server/` and `client/` and can be used as a CI gate in phase 17.

### Phase 2 - Server foundation: logging, config, error model, bootstrap

Branch: `refactor/reclaim-202-server-foundation`

Fixes: ARCH-02, ARCH-07, ARCH-11, ARCH-12.

- Add `server/src/utils/logger.ts` with levels and a redaction list covering emails, tokens, API keys, private keys, and verification codes. Replace every `console.*` in `server/src`. Delete the log lines in `routes/auth.ts` and `services/email.ts` that print recipient addresses, and the ones in `autoMatch.service.ts` that print full item descriptions and prompts.
- Add `server/src/config/env.ts`: a typed, zod-validated config module that reads every environment variable once and fails fast at boot with a list of what is missing. Replace scattered `process.env` reads. The `VITE_*` fallbacks come out in Phase 5.
- Split bootstrap: `app.ts` builds and exports the Express app with no side effects, and `server.ts` (or the existing `index.ts`) owns `dotenv`, config validation, and `app.listen`.
- Convert every route handler to `asyncHandler` and make `errorHandler` the single exit path. Replace ad-hoc `res.status(500).json({ error })` with thrown `AppError`s so the JSON error shape is uniform.

Decisions taken during the phase, not in the original scope:

- Fail-fast is narrow on purpose. Only two problems abort boot, and only under `NODE_ENV=production`: a missing `FIREBASE_SERVICE_ACCOUNT_KEY` (nothing reads or writes without it) and a `CLIENT_URL` still pointing at localhost (CORS and every email link break). Missing Cloudinary, LLM, email or blockchain configuration is reported as a boot warning instead, because each of those paths already guards itself at runtime, and aborting on them would turn a partly configured deployment that used to serve degraded into a crash loop. This was tightened after code review; the first cut aborted on all of them.
- A variable that is present but empty is treated as absent. `CLIENT_URL=` in a `.env` file would otherwise fail schema validation before the default could apply, and `LOG_LEVEL=INFO` would fail on casing, either of which would abort boot over a benign entry.
- The bootstrap is a three-file chain rather than two. `index.ts` loads `dotenv` and dynamically imports `server.ts`, which validates config and calls `listen`, and `app.ts` exports a side-effect-free `createApp()`. The dynamic import is what guarantees `config/env.ts` parses a populated `process.env`.
- The logger is the one module allowed to read `process.env` directly, because it has to be able to report a configuration failure that happened before `config/env.ts` finished parsing.
- Redaction is two-layered: sensitive-looking metadata keys are replaced wholesale, and every surviving string is scrubbed for email addresses, bearer tokens, and provider API keys. `statusCode` and `errorCode` are allow-listed, or the substring rule would redact them.
- `scripts/deploy-contract.ts` keeps its 13 `console.*` calls. It is a one-off operator CLI outside `src/`, and structured JSON logging would make its output worse.
- Three handlers keep an internal `try/catch` because they return a meaningful fallback rather than an error (`GET /api/cctv/classes` returns 503 with a hint, `GET /api/settings/mode` falls back to defaults, `GET /api/notifications/status` cannot throw). They are still wrapped in `asyncHandler`.

Exit: no `console.*` in `server/src`, boot fails loudly on a missing required variable, all endpoints return the same error envelope, both builds pass, regression matrix green.

Delivered: 192 `console.*` calls replaced across 25 files, 42 route handlers wrapped, 40 `process.env` reads collapsed into one typed module, server lint down from 270 to 62 warnings. Verified by booting `dist/index.js`: production with an empty environment exits 1 listing all five problems at once, development boots with those problems as warnings, `/health` returns 200 and an unknown path returns the uniform 404 envelope.

### Phase 3 - Authentication and authorization lockdown

Branch: `fix/reclaim-203-auth-hardening`

Fixes: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, SEC-11, SEC-13, SEC-14, SEC-19, ARCH-10, and the exposure half of UI-14.

This is the highest-risk phase for breaking the app, because several client services currently call these endpoints with no token. Client and server change in the same commits.

- Build the authorization matrix first (section 2.1 below), then implement it.
- Fix `authMiddleware` so `role` is not read from a custom claim the app never sets. Resolve the role from Firestore once and attach it, or drop `role` from the token-derived user entirely and require `requireRole` wherever role matters. Then fix or delete `requireOwnership`.
- Apply `authMiddleware` plus `requireAdmin` to: all `/api/settings` writes and `/analytics`, all `/api/cctv/*`, `POST /api/matches/verify`, `POST /api/handover/initiate`, `GET /api/handover/history`, `PUT /api/credits/:userId`, and all `/api/notifications/*`.
- Apply `authMiddleware` plus an ownership check to: `GET /api/handovers/user/:userId`, `GET /api/credits/:userId`, `GET /api/credits/history/:userId`, `GET /api/items/user/:userId`, `PUT /api/items/:id`, `PUT /api/items/:id/status`, `DELETE /api/items/:id`, `POST /api/auth/login-notification` (derive the uid from the token, ignore the body), and `POST /api/settings/profile-picture` (derive the uid from the token, ignore the body).
- Keep genuinely public: `GET /health`, `GET /api/settings/mode`, `POST /api/settings/visit`, `POST /api/handover/verify` and `GET /api/handover/status/:matchId` (the finder has only an emailed link, no account), and `GET /api/items` for the public browse list.
- `POST /api/handover/verify` stays public but gets its own strict limiter keyed on `matchId` as well as IP.
- Delete `POST /api/credits/signup-bonus` and move the bonus server-side in Phase 6, rather than securing an endpoint that should not exist.
- Update `client/src/services/matchService.ts` and `handoverService.ts` to go through `authFetch` for everything except the two public handover endpoints. Update `MyReportsPage`, `HandoversPage`, `ProfilePage`, `UserLayout`, `AdminSettings`, `AdminProfile`, `CCTVIntelligence`, `ItemHeatmap`, and `WelcomePage` to use `authFetch` where the endpoint is now protected.

Decisions taken during the phase, not in the original scope:

- Role comes from Firestore, resolved once in `authMiddleware` and attached to `req.user` along with `status`. `requireRole`, `requireActiveUser` and `requireOwnership` then read that attached value instead of each doing their own Firestore read, so an admin request costs one user read rather than two. A missing `users/{uid}` document is not an error: signup creates the auth account before the document, so the caller is treated as an active `user` and `profileExists` is exposed for routes that need to care.
- `requireOwnership` only works on an id that is already in the request. Item edit and delete own the resource through the item's `reportedBy`, which is only known after a read, so those two do the check inside the handler with a new `assertOwnerOrAdmin` helper rather than as middleware. Layering moves it in phase 14.
- Blocked users are now rejected on the routes that carry `requireActiveUser` or a role or ownership guard, where before `status: blocked` was only checked by helpers nothing called. This is a deliberate tightening, not a side effect.
- `POST /api/matches/claim` derives both the uid and the email from the token, so a claim can no longer be filed on behalf of another user id.
- `handoverVerifyLimiter` keys on match id plus a normalised client address through `ipKeyGenerator`, so one caller cannot grind codes across many handovers and an IPv6 client cannot rotate inside its own /64 for a fresh bucket. `POST /verify` and `GET /status/:matchId` get separate limiters: the verify page polls status on mount and after every failed attempt, so a shared bucket ran a legitimate session out of quota.

Added after code review, all verified against a running server:

- `GET /api/items` stays public but refuses a `reportedBy` filter that is not the caller's own uid. Without that, `?reportedBy=<victim-uid>` enumerated another user's reports and walked straight around the ownership guard on `GET /user/:userId`.
- Verification was only half fixed by adding `authMiddleware`. `/start` still took `userId` and `email` from the body, so any signed-in user could open a session attributed to any uid and point the success email, which carries the collection point, anywhere. Identity now comes from the token. `/:id/answer` and `GET /:id` now check the session's `claimantUserId`, because session ids are guessable and passing the questions resolves the item. `GET /item/:itemId` is admin only, since it lists every claimant on an item.
- `POST /api/matches/claim` now checks that a body-supplied `lostItemId` is the caller's own report. Deriving the uid from the token stopped the impersonation but left the ability to flip a stranger's lost item to `Matched`.
- `POST /api/matches/verify` takes `verifiedBy` from the token rather than the body. Besides the audit trail, a missing `adminId` wrote `undefined` into Firestore and threw, after the handover emails had already gone out.
- `authMiddleware` runs the Firestore lookup outside the token try/catch. A database blip was being reported as `401 Invalid token`, which the client maps to a forced sign-out.
- An account with no `users/{uid}` document is refused by every role, ownership and active-user guard rather than defaulting to an active `user`, restoring the 404 the previous implementation returned and covering a profile deleted out of band.

Exit: an unauthenticated `curl` against every non-public endpoint returns 401, a non-admin token against every admin endpoint returns 403, a user token against another user's resource returns 403, and every screen still works signed in as both a user and an admin.

Delivered: 18 endpoints that were fully public are now guarded, `POST /api/credits/signup-bonus` is deleted, and 19 client call sites moved to `authFetch`. Verified by probing the running server: all 17 return 401 with no token and with a malformed token, the deleted endpoint returns 404, and the six intentionally public routes (`/health`, `/api/settings/mode`, `/api/settings/visit`, `GET /api/items`, `GET /api/handover/status/:matchId`, `POST /api/handover/verify`) still answer without one. The 403 paths need real tokens and are part of the manual regression run.

#### 2.1 Authorization matrix (fill and keep current)

| Endpoint                                       | Public             | Auth | Admin | Ownership      |
| ---------------------------------------------- | ------------------ | ---- | ----- | -------------- |
| `GET /health`                                  | yes                |      |       |                |
| `GET /api/settings/mode`                       | yes                |      |       |                |
| `POST /api/settings/visit`                     | yes                |      |       |                |
| `POST /api/handover/verify`                    | yes (rate limited) |      |       |                |
| `GET /api/handover/status/:matchId`            | yes (rate limited) |      |       |                |
| `GET /api/items`                               | yes                |      |       |                |
| `GET /api/items/:id`                           | yes                |      |       |                |
| `GET /api/items/user/:userId`                  |                    | yes  |       | yes            |
| `POST /api/items`                              |                    | yes  |       | uid from token |
| `PUT /api/items/:id`                           |                    | yes  |       | yes            |
| `PUT /api/items/:id/status`                    |                    | yes  | yes   |                |
| `DELETE /api/items/:id`                        |                    | yes  |       | yes            |
| `GET /api/matches`, `/all`, `/item/:itemId`    |                    | yes  | yes   |                |
| `POST /api/matches/search`                     |                    | yes  |       |                |
| `POST /api/matches/claim`                      |                    | yes  |       | uid from token |
| `POST /api/matches/verify`                     |                    | yes  | yes   |                |
| `POST /api/handover/initiate`                  |                    | yes  | yes   |                |
| `GET /api/handover/history`                    |                    | yes  | yes   |                |
| `GET /api/handovers/user/:userId`              |                    | yes  |       | yes            |
| `GET /api/credits/:userId`, `/history/:userId` |                    | yes  |       | yes            |
| `PUT /api/credits/:userId`                     |                    | yes  | yes   |                |
| `GET /api/settings`                            |                    | yes  |       |                |
| `PUT /api/settings`                            |                    | yes  | yes   |                |
| `GET /api/settings/analytics`                  |                    | yes  | yes   |                |
| `POST /api/settings/profile-picture`           |                    | yes  |       | uid from token |
| `POST /api/auth/login-notification`            |                    | yes  |       | uid from token |
| `/api/cctv/*`                                  |                    | yes  | yes   |                |
| `/api/verification/*`                          |                    | yes  |       | see Phase 9    |
| `/api/notifications/*`                         |                    | yes  | yes   |                |

### Phase 4 - Input validation, sanitization, and mass assignment

Branch: `feature/reclaim-204-validation-sanitization`

Fixes: SEC-12, SEC-15, LOG-02, PERF-02.

- Wire the existing `itemInputSchema` and `itemUpdateSchema` to `POST /api/items` and `PUT /api/items/:id` via `validate`. Add and wire schemas for every other mutating route: settings, credits, matches, handover, verification, notifications, cctv, auth.
- Make `validateQuery` and `validateParams` actually replace `req.query` and `req.params` with the parsed values, which the current implementations do not do. Add a query schema for `GET /api/items` with a coerced, bounded `limit` (default 50, max 100), which also fixes PERF-02.
- Fix mass assignment: build the Firestore update object from an explicit allowlist rather than spreading `updates`. `status`, `reportedBy`, `matchScore`, `matchedItemId`, `matchedUserId`, `cloudinaryUrls`, `verifiedAt`, and `verificationConfidence` are server-owned and must not be writable through the generic update route.
- Fix LOG-02: strip undefined values before every Firestore write. Add a shared `stripUndefined` helper, or set `ignoreUndefinedProperties: true` on the Firestore instance and use an explicit `FieldValue.delete()` where removal is intended. Prefer the explicit helper so intent stays visible.
- Apply `sanitizeObject` to user-supplied strings before persistence, and HTML-escape every interpolated value in the email templates, which is the other half of SEC-09.

Decisions taken during the phase, not in the original scope:

- The schemas moved out of `validation.middleware.ts` into `src/schemas/*.schema.ts`, one file per domain behind a barrel. The middleware file now holds only the three factories and the sanitization helpers, which matches the one-responsibility-per-file rule and keeps phase 14 from having to move them again.
- The allowlist on `PUT /api/items/:id` is role aware. The admin item modal already edits `status`, `type` and `matchScore` through this route, so a flat ban would have removed a working admin feature. An owner can set only the descriptive fields; those three are accepted from an admin and dropped for everyone else. Nothing else on the item (`reportedBy`, `matchedItemId`, `matchedUserId`, `claimedBy`, `verifiedAt`, `verificationConfidence`, timestamps) is writable through the route by anyone.
- `cloudinaryUrls` is accepted on the update route but only as a removal: the user edit modal deletes an image by resending the remaining URLs. Every URL in the request must already be on the item, counting the legacy single `imageUrl`, so the field cannot be used to point a record at an arbitrary URL.
- `description` requires 10 characters on create, as the original schema declared, but only 1 on update. Items reported before the rule existed have shorter descriptions and must stay editable. Both report modals now check the same rule before submitting, so the requirement surfaces in the form rather than as a 400.
- Sanitization happens at output, not at rest. HTML-encoding values on the way into Firestore would have stored `John&#x27;s wallet` and shown it that way in the UI and in every JSON response. Instead the schemas strip control characters and trim on the way in, and `escapeHtml` in `utils/html.ts` wraps every interpolated value in the email templates, which is what SEC-09 actually needed. `sanitizeString` and `sanitizeObject` are deleted rather than left as a second, unused escaper: they had no call sites, and they missed `&`.
- Single-line fields (name, location, category, color, collection point) drop CR and LF; only `description` keeps its line breaks. `itemName` is interpolated into email `subject:` headers, so a newline surviving the sanitizer is a header injection primitive even if the transport happens to reject it.
- A non-admin who sends `status`, `type` or `matchScore` to `PUT /api/items/:id` gets a 200 with those fields ignored, not a 403. Silently dropping unknown or unauthorised fields is what an allowlist normally does, and no client sends them on that path; a 403 would make a future client's harmless extra field fatal.

Found while wiring the phase, same defect class as LOG-02:

- `updateCredits` wrote `relatedItemId: undefined` whenever it was called without a related item, which is every signup bonus. Firestore rejects undefined values, so the credit transaction log write threw. Now stripped.

Exit: every mutating endpoint rejects malformed input with a 400 and a field list, a crafted `PUT /api/items/:id` cannot change `status` or `reportedBy`, `PUT /api/items/:id/status` with only `{ status }` returns 200, and `?limit=abc` returns 400 rather than throwing.

### Phase 5 - Secrets, keys, and platform rules

Branch: `fix/reclaim-205-secrets-and-rules`

Fixes: SEC-16, SEC-16b, SEC-17, SEC-20, SEC-21.

- Move all LLM work off the browser. Add `POST /api/ai/analyze-image` and `POST /api/ai/enhance-description` on the server, backed by the existing `callLLM` so the admin AI-provider setting finally applies to client-triggered analysis too. Rewrite `client/src/services/aiService.ts` to call those endpoints through `authFetch` and delete every `import.meta.env.VITE_GROQ_API_KEY` and `VITE_GEMINI_API_KEY` reference.
- Remove the `VITE_*` fallbacks from `server/src/utils/llm.ts`, `routes/cctv.ts`, and `services/email.ts`. Server keys come from server-only names via the Phase 2 config module.
- Rotate every key that was ever in a client bundle: Groq, Gemini, and the Firebase web API key if it was ever restricted by key rather than by domain. Note the rotation date here when done.
- Add `firestore.rules` and `firestore.indexes.json` to the repo. Rules must make `role`, `status`, `credits`, `lostItemsCount`, `foundItemsCount`, and `totalItemsCount` writable only by the Admin SDK, make `items` writable only by the Admin SDK, and scope `users/{uid}` reads to the owner and to admins. Then change `AuthContext` to stop writing `role`, `status`, and `credits` from the browser, which ties into Phase 6.
- Harden `models/app.py`: `debug` from an env var defaulting to false, CORS restricted to the server origin, and a shared-secret header that the Express proxy sends and Flask requires.
- Move the Firebase web config to required env with no hardcoded fallbacks, and replace the `VITE_ADMIN_EMAIL` filter in `userService.ts` with a role-based filter.

Decisions taken during the phase, not in the original scope:

- `POST /api/auth/profile` is new. Telling `AuthContext` to stop writing `role`, `status` and `credits` leaves nobody creating `users/{uid}`, and phase 3 made every role, ownership and active-user guard return 404 without one. The endpoint creates the profile on first sign-in with server-decided defaults and refreshes `lastLoginAt` afterwards. It runs on `authMiddleware` alone, because the whole point is that the profile may not exist yet. It also fills in a display name that arrives late, which is the race the old client-side `setDoc` was working around.
- `PUT /api/users/:userId/status` is new, for the same reason on the other side: the rules deny `status` to the browser, and the admin Users screen blocks and unblocks through a direct `updateDoc`. An admin cannot change their own status through it.
- The AI provider selector is gone from both report modals. Which provider runs is now the admin `aiProvider` setting applied inside `callLLM`, so a per-request toggle in the UI would have been a control that does nothing. `GET /api/ai/status` replaces `getAvailableProviders()` so the admin add-item screen can still say when no provider is configured.
- `callLLM` gained multi-image support (`options.images`). The report modal analysed several photos of one item in a single Groq call, and that behaviour had to survive the move to the server.
- `createItem`, `updateItem` and `deleteItem` in `client/src/services/itemService.ts` are deleted. They wrote to `items` directly, which the rules now deny, and nothing imported them: every caller already used the `*ViaApi` variants. Leaving them would have left three functions that fail the moment anyone calls them.
- The redundant `photoURL` write in `ProfilePage` is deleted. `POST /api/settings/profile-picture` already writes that field with the Admin SDK, so the client write only existed to duplicate it, and the rules now deny it.
- The image MIME check on `/api/ai/analyze-image` is a shape check (`image/*`), not an allowlist of four types. The file inputs accept `image/*`, so a HEIC or AVIF photo has to keep reaching the provider.
- The Flask service fails closed: with no `YOLO_SERVICE_TOKEN` set it answers 503 on everything except `/health`, and prints why at startup. Failing open would have made the token optional in practice.

Fixed after code review, all re-verified:

- `POST /api/auth/profile` was mounted under `authLimiter`, which is 5 requests per 15 minutes per IP because it is meant for credential attempts. The route runs on every app mount, so a few page refreshes returned 429, and a 429 on a brand-new account meant `users/{uid}` was never created and every guarded endpoint then 404d for that user. It now has its own 300-per-15-minute limiter; the credential routes keep the strict one.
- Sign-in called the bootstrap from two places at once (the auth state listener and the sign-in call), and a read-then-write let both take the create branch, resetting `createdAt` and `credits`. Creation is now `create()`, which is atomic: the loser gets ALREADY_EXISTS and falls through to the refresh path.
- `displayName` and `photoURL` are now truncated or dropped rather than rejected. This is the only route that creates a profile, so a 55-character Google display name would otherwise have wedged that account out of the app permanently, with every retry sending the same name.
- `items` reads are admin only in the rules, not public. Item documents carry reporter emails, coordinates and the collection point, and an unauthenticated client could have paged the whole collection with the public web config. Every direct read in `client/src` is an admin screen; public browse is `GET /api/items`, which is rate limited and bounded by `limit`.
- The `users` update rule is `false` rather than a field denylist. The last client write to `users` is gone, and a denylist would still have let a signed-in user add arbitrary new keys to their own document.
- The Flask service binds `0.0.0.0` again. Defaulting to loopback would have made the vision service unreachable on any container or multi-host deployment the moment this change landed, and the shared secret is the control now, not the bind address.
- `hmac.compare_digest` compares bytes. Werkzeug decodes headers as latin-1, so a token byte above 0x7F raised `TypeError` and produced a 500 with a traceback instead of a 401.
- `/api/ai/analyze-image` bounds each image at roughly 1.5mb of source photo. Five uncompressed phone photos exceeded the 10mb body limit and came back as Express's HTML 413 page, which the client rendered as "Analysis failed: Request failed". Client-side compression on this path is UI-15, in phase 12.
- A failed YOLO call now distinguishes a rejected shared secret from an unreachable process. With the token mandatory, the likeliest failure after this phase is a token mismatch, and the old message told the operator to check that a running service was running.
- `AuthContext` no longer claims `status: 'active'` when the profile call fails. The server refuses a blocked account on every endpoint regardless, so asserting it client-side was a false signal with no upside.

Still outstanding, and not something code can do:

- Key rotation. Groq and Gemini keys were in shipped bundles and are compromised until rotated; the Firebase web API key needs rotating too if it was ever restricted by key rather than by domain. Record the date here when done.
- `firebase deploy --only firestore` has to run for the rules and indexes to take effect. Until then the files are inert and the browser still has its old permissions.

Exit: `grep -r "VITE_GROQ\|VITE_GEMINI" client/src` returns nothing, the built bundle contains no LLM key, rules are deployed and a direct client write of `role: "admin"` is rejected, and the Flask service refuses unauthenticated requests and does not run the debugger.

### Phase 6 - Credits: one source of truth

Branch: `fix/reclaim-206-credits-single-source`

Fixes: LOG-01, LOG-01b, LOG-01c, LOG-18, LOG-18b.

- Decide and document the single store. Recommendation: `users/{uid}.credits` as the balance and `creditTransactions` as the ledger. Retire the `credits` collection.
- Write a one-off migration script that reconciles any balance in `credits/{uid}` into `users/{uid}.credits` and records a reconciling ledger entry. Run it once against the real project and note the date here.
- Rewrite `PUT /api/credits/:userId` (admin only after Phase 3) to go through `CreditsService.updateCredits` so there is exactly one write path.
- Make `updateCredits` transactional: read the balance, apply the delta, and write the balance plus the ledger entry atomically, using `set(..., { merge: true })` so a missing user document does not silently swallow the award.
- Move the signup bonus server-side. Award it once, keyed on a `signupBonusAwarded` flag or an idempotent ledger check, at first authenticated contact. Remove `credits: 10` from both client-side user-creation paths and delete `POST /api/credits/signup-bonus`.
- Remove the `DEFAULT_CREDITS` inconsistency and the no-op `replace(/_/g, '_')`.

Exit: a new signup receives exactly 10 credits once, visible in the header and on the profile; an admin adjustment through the API is reflected in `GET /api/credits/:userId` immediately; a completed handover awards 20 to the finder and 10 to the owner, skips admins, and appears in the ledger exactly once.

### Phase 7 - Handover integrity

Branch: `fix/reclaim-207-handover-integrity`

Fixes: SEC-18, LOG-10, LOG-10b, LOG-11, LOG-12, LOG-13, LOG-14, LOG-15.

- Replace `Math.random()` with `crypto.randomInt`, and replace the bare SHA-256 with an HMAC keyed on a server secret, or a slow hash. Store the algorithm version on the document so old codes still verify.
- Decide the policy for `validateHandoverCriteria` and implement it rather than logging it. Recommendation: block on a failed check for automatic handovers, and allow an explicit admin override flag for manual ones. Fix the "max 200m" message to read from `LOCATION_RADIUS_KM`. Delete the empty `else` block.
- Make `initiateHandover` refuse to reset a code document whose status is `blocked` or `verified`. Re-issuing must be an explicit admin action with its own audit entry.
- Fix the blocking policy. Three failed code entries must not block the owner's account, because the owner is not the party typing. Recommendation: block the handover session, notify both parties and the admin, and require an admin to re-issue. If account blocking stays, it must target the account that submitted the failures and must be reversible from the admin UI.
- Wrap the attempt increment and the status transition in a Firestore transaction so parallel guesses cannot exceed the cap.
- Make `completeHandover` defensive: verify both item documents and the match document exist before batching, use `set(..., { merge: true })` where appropriate, and skip the match delete when the match id is synthetic. It must never fail after the code has been accepted.
- Fix both `toDate` helpers to return `null` for missing values, and make callers treat a missing date as a failed check rather than as "now".
- Mark expired codes as `expired` when the expiry check trips, instead of leaving them `pending` forever.

Exit: a wrong code three times blocks the session and no account, re-triggering matching does not unblock it, concurrent verify requests cannot exceed 3 attempts, and a completed handover writes the handover record, archives the match, sets both items to `Claimed`, and awards credits even when the match document is missing.

### Phase 8 - Matching pipeline and scoring

Branch: `refactor/reclaim-208-matching-pipeline`

Fixes: UI-13, LOG-04, LOG-05, LOG-06, LOG-07, LOG-08, LOG-09, LOG-25, LOG-26, LOG-27, PERF-05, PERF-11, ARCH-03.

- Consolidate into one `MatchingService` with explicit stages: candidate retrieval, cheap pre-filters, scoring (color, location, time), semantic scoring, visual scoring, normalization, thresholding. `matching.ts` and `autoMatch.service.ts` become two entry points onto the same pipeline. Delete the duplicated `calculateSemanticScore`, `calculateImageScore`, and `toDate`.
- Fix the normalization bug: compute the achievable maximum from the components that actually ran, not from a hardcoded `100 - image`. If Clarifai is unconfigured or either side lacks images, drop the image weight from the denominator. Apply the same treatment to a missing color or missing coordinates.
- Fix the tag pre-filter. Either make it a score contribution rather than a hard gate, or widen the fallback (lemmatize, add category and color tokens, and let a high semantic score override it). A hard gate on exact token overlap is the single biggest reason matching fails today.
- Restore `tags` and `description` to non-zero weights, or delete `calculateTagScore` and `calculateDescriptionScore` along with their stale header comment. Do not keep scorers wired to a zero weight. Fix `calculateCategoryScore` to honour its weight instead of `|| 5`.
- Initiate at most one handover per matching run, for the single best candidate, after the loop. Record the other above-threshold candidates as match records without side effects.
- Check for an existing match in both orientations before creating one.
- Only write `matchScore` to the item when a match actually crossed the threshold, or write it to a distinct `bestCandidateScore` field the UI can label honestly.
- Pass `cloudinaryUrls` into `triggerAutoMatching`, and make manual search convert `imageBase64` into something the image scorer can consume, either by uploading it or by accepting base64 in the Clarifai call.
- Add a bounded concurrency pool, a per-call timeout, and retry with backoff around every LLM and Clarifai call. Cache the provider setting per request rather than per call.
- Record the score breakdown for every evaluated candidate behind a debug flag so match quality is diagnosable.

Exit: a known-good lost and found pair matches, a known-bad pair does not, one report produces at most one handover, disabling Clarifai does not change the ranking, and a matching run against 50 candidates makes a bounded number of LLM calls and completes within the request budget.

### Phase 9 - Item lifecycle and status model

Branch: `fix/reclaim-209-item-lifecycle`

Fixes: UI-07, UI-07b, LOG-03, LOG-16, LOG-17, LOG-21, LOG-28.

- Settle the field name once. Recommendation: keep `collectionPoint` as the canonical name, have the item create and update routes map the incoming `collectionLocation` onto it, persist `collectionCoordinates`, and add a migration for existing documents. Verify that the handover email and the admin Handovers screen then show a real collection point.
- Make item creation resilient: persist the item, respond, and run matching asynchronously as a fire-and-forget task with its own error handling, or as a queued job. Creation must never 500 because matching failed. If the client needs the match result, add a follow-up endpoint or push the result through the notification path.
- Define one status machine and document it here: `Pending -> Matched -> Claimed`, with `Resolved` either removed or given a precise meaning. Make the verification agent and the handover flow converge on the same terminal state, and update the dashboard counters to match.
- Harden the verification agent: enforce sequential answering, reject re-answers, cap total attempts, and use a transaction or per-answer subdocuments so concurrent submissions do not lose answers.
- Add `grok_only` and `grok_with_fallback` to the settings `AIProvider` union and to the admin settings UI options, so the provider selector matches what `llm.ts` implements.
- Stop returning unresolved `serverTimestamp()` sentinels in the create response. Read the document back, or return an ISO timestamp.

Exit: the handover email shows the collection point the finder entered, creating an item with matching disabled still returns 201, the admin can select Grok, and the status shown on My Reports matches the status the admin sees.

### Phase 10 - Admin review and verification workflow

Branch: `feature/reclaim-210-admin-review-workflow`

Fixes: UI-01, UI-02, LOG-22, LOG-22b.

This phase builds the missing half of a documented core workflow, so it needs an explicit design decision before implementation (see section 6).

- Decide what approval means for a pending item: a moderation gate before the item is publicly visible and eligible for matching, or a review of a proposed match. The current data model has only `status: 'Pending'`, which conflates "not yet matched" with "not yet approved". Recommendation: add an explicit `moderation: 'pending' | 'approved' | 'rejected'` field so approval and match state stay independent, and default existing items to `approved` in a migration.
- Add approve and reject actions to `PendingApprovalsPage`, wired to a new admin-only endpoint, with an optimistic list update and an error toast.
- Add verify and reject actions to `MatchesPage`, wired to the existing `POST /api/matches/verify`, showing the score breakdown and both items side by side before the admin commits.
- Fix `POST /api/matches/verify` itself: set the item status when the handover is initiated, and stop synthesizing match documents containing the literal `'unknown'` as an item id. Require both real item ids, or reject the request.
- Add an admin-visible audit trail: who approved, who verified, when, and the outcome.

Exit: an admin can approve or reject a pending item and see the list update, an admin can verify a match and both parties receive their handover emails, a rejected claim applies the penalty and resets the item, and no match document ever contains `'unknown'`.

### Phase 11 - CCTV detection pipeline

Branch: `fix/reclaim-211-cctv-pipeline`

Fixes: UI-03, UI-04, LOG-24.

- Carry the detected crop through registration. `AddItemModal` must accept seeded base64 images as uploadable content, not only as a preview, so the created item actually has the CCTV image.
- Replace the hardcoded `"Admin Office (CCTV)"` location with a camera-location selector backed by real coordinates, defaulting to the configured `mapCenter`, and let the admin set the sighting time rather than defaulting to now. Without this, CCTV items score zero on location and near-zero on time.
- Route the CCTV Groq calls through `callLLM` so the admin AI-provider setting applies, and add timeouts to the YOLO proxy calls.
- Check the request body size against the 10 MB limit before posting video frames, and either stream, batch, or downscale frames client-side. A multi-frame analyze request is the most likely 413 in the app.
- Fix `framesWithTarget` to count before truncation.

Exit: registering a detection produces an item with the crop attached, a real location with coordinates, and a chosen timestamp, and that item participates in matching. A several-minute video analysis completes without a 413.

### Phase 12 - Client contract and UX defects

Branch: `fix/reclaim-212-client-contract-fixes`

Fixes: UI-05, UI-06, UI-08, UI-09, UI-10, UI-11, UI-12, UI-15, LOG-20.

- Align the verify page with the server contract: read `attemptsLeft`, and map the code-document statuses (`pending`, `verified`, `blocked`, `expired`) onto the page states. Add an explicit expired state.
- Fix `getUserItemsCount` to filter on `reportedBy` and `reportedByEmail`, or replace it with the counts the server already maintains on the user document.
- Replace the header credit cache with a shared credits hook that refetches after any credit-affecting action, and delete the `creditUpdate` listener that nothing dispatches.
- Add a catch-all route with a real 404 page.
- Fix the blocked-user message so it survives sign-out: hold it outside the auth state that sign-out clears, or pass it through navigation state to `/auth`.
- Let admins use `/app/*` routes instead of being bounced, and redirect only from the bare `/app` landing.
- Compress and validate images before upload in `ReportItemModal` using the existing compression helper, cap the total payload, and show per-file feedback instead of a silent 413.
- Make signup deterministic: one code path creates the user document regardless of whether a display name was supplied, and the signup bonus is triggered exactly once, server-side after Phase 6.

Exit: wrong codes show a decrementing attempts counter, a completed handover link shows the completed state, profile item counts are correct, the credit badge updates after a handover, an unknown URL shows a 404, and a blocked user sees why they were signed out.

### Phase 13 - Server-authoritative client and shared types

Branch: `refactor/reclaim-213-client-service-layer`

Fixes: ARCH-08, ARCH-09.

- Create one source of truth for the domain types shared by client and server, and import it in both. Remove the drifted duplicates in `client/src/services/itemService.ts` and the client-local `Match`, `User`, and handover interfaces.
- Delete the direct client Firestore mutations `addItem`, `updateItem`, `deleteItem`, and `updateUserStatus`, and route them through server endpoints so Cloudinary upload, matching, counts, and credits always run. Keep reads on Firestore only where the Phase 5 security rules permit and pagination exists.
- Standardize the client API layer: every call goes through typed `authGet`, `authPost`, `authPut`, and `authDelete` wrappers with consistent error surfacing. Remove the `const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001"` line duplicated across 10 files.

Exit: `grep -r "addDoc\|updateDoc\|deleteDoc" client/src` returns only reads or nothing, every screen still works, and both builds pass.

### Phase 14 - Layered server architecture

Branch: `refactor/reclaim-214-server-layering`

Fixes: ARCH-01, ARCH-04, ARCH-06.

- Introduce `route -> controller -> service -> repository`. Repositories wrap Firestore collections (`ItemRepository`, `UserRepository`, `MatchRepository`, `HandoverRepository`, `CreditRepository`, `SettingsRepository`) so no route or service touches `collections.*` directly.
- Move business logic into injectable services with explicit interfaces: `ItemService`, `MatchingService`, `HandoverService`, `CreditsService`, `VerificationService`, `NotificationService`, `BlockchainService`, `CloudinaryService`, `CctvService`.
- Merge `routes/handover.ts` and `routes/handovers.ts` into one router with clear sub-paths, keeping both mount points as aliases in the same commit that updates the client callers.
- Normalize file naming to `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.schema.ts`, `*.types.ts`.
- Do this one route group at a time, one commit each, in this order: items, matches, handover, credits, settings, cctv, auth, verification, notifications. API contracts do not change.

Exit: no `collections.*` import outside `repositories/`, each route file only wires middleware and delegates, both builds pass, and the regression matrix is green after every group.

### Phase 15 - Client component decomposition

Branch: `refactor/reclaim-215-client-components`

Fixes: ARCH-13, UI-16.

- Split largest first, one component per commit: `ReportItemModal` (875), `MainDashboard` (865), `CCTVIntelligence` (836), `UsersManagement` (817), `AdminSettings` (725), `AddItemModal` (675), `LandingPage` (569), `ItemDetailModal` (562).
- Extract data access into hooks (`useItems`, `useMatches`, `useHandovers`, `useCredits`, `useCctv`, `useSettings`) so no component fetches inside JSX.
- Extract the shared report and add-item form into one component used by both the user and the admin path, since the two currently diverge (only one collects a collection location, only one sends a reporter email).
- Replace every `window.alert` with the app's own toast or inline error component.

Exit: no component over roughly 250 lines, visuals and behavior unchanged, both builds pass.

### Phase 16 - Performance, indexes, and rate limits

Branch: `perf/reclaim-216-performance`

Fixes: PERF-01, PERF-03, PERF-04, PERF-06, PERF-07, PERF-08, PERF-09, PERF-10, PERF-12.

- Add `firestore.indexes.json` covering every composite query the code issues: `items(type,status)`, `items(reportedBy,createdAt)`, `items(type,createdAt)`, `items(status,createdAt)`, `creditTransactions(userId,createdAt)`, `handovers(status,handoverTime)`, `verifications(itemId,createdAt)`. Then remove the in-memory sort workarounds in `getCreditHistory` and `handovers.ts`.
- Denormalize handover participants as `participantIds: [lostPersonId, foundPersonId]` so the user handover query is an indexed `array-contains` instead of a full-collection scan.
- Replace the live re-matching in `GET /api/matches/user/:userId` with a read of persisted match records.
- Add `AbortSignal.timeout` to every outbound fetch (Groq, Gemini, Grok, Clarifai, YOLO) and delete the dead `timeout` property and its `@ts-ignore`.
- Move admin screens off full-collection client reads onto paginated server endpoints, and make `MainDashboard` poll a single aggregate stats endpoint rather than refetching three collections every 30 seconds.
- Use `getIdToken()` and let the SDK handle refresh, instead of forcing one per request.
- Re-tune the limiters: a real ceiling on `apiLimiter`, a dedicated stricter limiter for expensive AI routes, and move `login-notification` off the 5-per-15-minute auth limiter that legitimate sign-ins trip.
- Lazy-load `exceljs` at the point of export so the 936 kB chunk is not in the initial graph.

Exit: no query fails for a missing index on a fresh project, the dashboard makes one request per refresh, the export still works, and the initial bundle drops by roughly 270 kB gzipped.

### Phase 17 - Tests and CI

Branch: `test/reclaim-217-tests-and-ci`

Fixes: ARCH-14.

- Unit tests for the pure logic first, because that is where the subtlest bugs live: `scoring.ts` (every tier boundary, the normalization path, the weight invariant), `handover.service.ts` (criteria validation, attempt cap, expiry, completion with a missing match), `credits.ts` (idempotent signup bonus, transactional balance).
- Regression tests pinned to specific defect IDs from section 1, so a fix cannot silently revert. Name them after the ID, for example `LOG-01 credits read and write hit the same store`.
- Integration tests against the Firebase emulator for the core workflows: report to match, admin verify to handover, code verify to completion, credits awarded.
- Client tests for the auth guards, the verify page state machine, and the report form validation.
- A GitHub Actions workflow running lint, both builds, and both test suites on every PR into `develop`.

Exit: `npm test` passes in both packages, CI is green and required on `develop`.

### Phase 18 - Dead code, docs, and final review

Branch: `chore/reclaim-218-deadcode-docs`

Fixes: UI-14, LOG-23, ARCH-05, ARCH-17, ARCH-18.

- Delete `utils/safety.ts`, `utils/embeddings.ts` (or wire real embedding-based retrieval into the matching pipeline in Phase 8 and keep it), and the chat and conversation types, after confirming there are no importers.
- Delete the endpoints that survived Phase 3 with no caller and no plan: the unused notification senders and any verification routes made redundant by the Phase 9 decision.
- Fix the duplicate `'complete'` in `ConversationState` and reconcile or delete `SAFETY_LIMITS`.
- Move the mid-file import in `routes/matches.ts` to the top and delete unused imports.
- Update the README to match reality (YOLOv11 not YOLOv8, the corrected setup steps, the new env variable names) and record the key rotation and migration dates from Phases 5, 6, and 9.
- Final security pass over the full diff, then hand `develop` to the user for the merge into `main`.

Exit: no dead module in the build, docs match the code, `develop` ready to merge.

## 3. Git protocol

Branches and commits are created by you, never by Claude. At the start of each phase Claude prints:

```
ACTION NEEDED (you run this):
git checkout develop
git pull
git checkout -b <branch-for-this-phase>
```

and waits. After the changes are made and both builds pass, Claude prints the commit command and waits again:

```
ACTION NEEDED (you run this):
git add -A
git commit -m "fix: <short summary>" -m "<one single-line detailed description of what changed>"
```

Rules:

- First `-m` is `feat|fix|chore|refactor|docs|test|perf: short summary`.
- Second `-m` is one single-line detail. Never a third `-m`.
- No Claude or Anthropic trailer of any kind.
- Phases 3, 4, 6, 7, and 9 change API contracts. Client and server changes for a contract go in the same commit.
- Phase 14 is committed one route group at a time.

## 4. Regression matrix

Run after every phase. Record pass or fail with the date, and note any regression in the phase's commit message.

| #   | Workflow                  | Steps                                                                              | Expected                                                                                                             |
| --- | ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| R1  | Google sign-in            | Sign in with Google as a new account                                               | User document created once, role `user`, credits 10, redirected to `/app`                                            |
| R2  | Email sign-up and sign-in | Sign up with and without a display name, sign out, sign back in                    | One user document, one signup bonus, display name preserved                                                          |
| R3  | Blocked user              | Admin blocks a user, that user signs in                                            | Signed out with a visible reason                                                                                     |
| R4  | Admin gating              | Sign in as admin, then as user, and try `/admin`                                   | Admin reaches the dashboard, user is redirected                                                                      |
| R5  | Report lost               | Report a lost item with 3 photos and a picked location                             | 201, item visible in My Reports, no 413, no 500                                                                      |
| R6  | Report found              | Report a found item with a collection location                                     | Collection point stored and shown in the admin view                                                                  |
| R7  | Auto-match                | Report a matching pair within the window                                           | Exactly one match record, exactly one handover session, one email pair                                               |
| R8  | Admin approval            | Approve and reject pending items                                                   | List updates, item state changes, audit entry written                                                                |
| R9  | Admin verify              | Verify a match from the Matches screen                                             | Handover initiated, both emails sent, item status advanced                                                           |
| R10 | Handover success          | Open the emailed link, enter the correct code                                      | Success state, both items `Claimed`, handover record written, credits awarded, blockchain hash recorded when enabled |
| R11 | Handover failure          | Enter a wrong code three times                                                     | Attempts counter decrements, session blocked, no account blocked, admin notified                                     |
| R12 | Handover replay           | Re-trigger matching for a blocked handover                                         | Session stays blocked                                                                                                |
| R13 | Credits                   | Check the header, profile, and ledger after R10                                    | All three agree                                                                                                      |
| R14 | CCTV detect               | Detect an object in a frame and register it as found                               | Item created with the crop attached and real coordinates                                                             |
| R15 | CCTV video                | Analyze a multi-frame video                                                        | Keyframes returned, no 413, stats correct                                                                            |
| R16 | Profile                   | Upload an avatar, view stats                                                       | Avatar updates, item counts correct                                                                                  |
| R17 | 404                       | Visit an unknown URL                                                               | 404 page, not a blank screen                                                                                         |
| R18 | Authorization             | `curl` every protected endpoint with no token, a user token, and another user's id | 401, 403, 403 as per the matrix in 2.1                                                                               |

## 5. Progress log

| Phase | Branch                                        | Started | Finished | Server build | Client build | Regression | Notes                          |
| ----- | --------------------------------------------- | ------- | -------- | ------------ | ------------ | ---------- | ------------------------------ |
| 0     | `chore/reclaim-200-baseline`                  |         |          | PASS         | PASS         |            | Baseline captured at `48ff74e` |
| 1     | `chore/reclaim-201-hygiene-and-config`        | 2026-08-29 | 2026-08-29 | PASS | PASS | n/a (no behaviour change) | ARCH-15, ARCH-16 fixed. ESLint now runs on server for the first time: 270 warnings (219 no-console, 33 any, 13 unused). Client lint 34 errors to 0 errors, 38 warnings. |
| 2     | `refactor/reclaim-202-server-foundation`      | 2026-08-29 | 2026-08-29 | PASS | PASS | pending manual run | ARCH-02, ARCH-07, ARCH-11, ARCH-12 fixed. Opened with the phase 1 formatting pass (97 files, 92 with a content diff). 192 `console.*` calls in `src/` replaced by the redacting logger, 42 route handlers wrapped in `asyncHandler`, every `process.env` read moved into `config/env.ts`. Server lint 270 to 62 warnings. |
| 3     | `fix/reclaim-203-auth-hardening`              | 2026-08-29 | 2026-08-29 | PASS | PASS | pending manual run | SEC-01 to SEC-11, SEC-13, SEC-14, SEC-19 and ARCH-10 fixed. Role now resolved from Firestore in `authMiddleware`; 17 public endpoints guarded; `signup-bonus` deleted; 19 client calls moved to `authFetch`. |
| 4     | `feature/reclaim-204-validation-sanitization` | 2026-09-03 | 2026-09-03 | PASS | PASS | pending manual run | SEC-12, SEC-15, LOG-02, PERF-02 fixed, plus CCTV-28 left over from phase 3. Schemas moved to `src/schemas/*.schema.ts` and wired to all 20 mutating and parameterised routes; `validateQuery`/`validateParams` now replace the parsed values; `PUT /api/items/:id` builds its write from a role-aware allowlist; `stripUndefined` added; email templates HTML-escape every interpolated value. Code review found three real breaks, all fixed and re-verified: the CCTV `frames` schema expected strings where the client sends `{image, timestamp}` objects, the item update schema rejected the empty descriptions and locations that legacy items carry, and a cleared date input serialised to `null` and was rejected. |
| 5     | `fix/reclaim-205-secrets-and-rules`           | 2026-09-03 | 2026-09-03 | PASS | PASS | pending manual run | SEC-16, SEC-16b, SEC-17, SEC-20, SEC-21 fixed in code. LLM calls moved behind `/api/ai/*`; every `VITE_*` read is gone from `client/src` and `server/src`; `firestore.rules`, `firestore.indexes.json`, `firebase.json` and `.firebaserc` added; profile creation and user blocking moved to the API; Flask service now requires a shared secret, restricts CORS and defaults the debugger off. KEY ROTATION AND `firebase deploy` ARE STILL OUTSTANDING. |
| 6     | `fix/reclaim-206-credits-single-source`       |         |          |              |              |            |                                |
| 7     | `fix/reclaim-207-handover-integrity`          |         |          |              |              |            |                                |
| 8     | `refactor/reclaim-208-matching-pipeline`      |         |          |              |              |            |                                |
| 9     | `fix/reclaim-209-item-lifecycle`              |         |          |              |              |            |                                |
| 10    | `feature/reclaim-210-admin-review-workflow`   |         |          |              |              |            |                                |
| 11    | `fix/reclaim-211-cctv-pipeline`               |         |          |              |              |            |                                |
| 12    | `fix/reclaim-212-client-contract-fixes`       |         |          |              |              |            |                                |
| 13    | `refactor/reclaim-213-client-service-layer`   |         |          |              |              |            |                                |
| 14    | `refactor/reclaim-214-server-layering`        |         |          |              |              |            |                                |
| 15    | `refactor/reclaim-215-client-components`      |         |          |              |              |            |                                |
| 16    | `perf/reclaim-216-performance`                |         |          |              |              |            |                                |
| 17    | `test/reclaim-217-tests-and-ci`               |         |          |              |              |            |                                |
| 18    | `chore/reclaim-218-deadcode-docs`             |         |          |              |              |            |                                |

## 6. Track A open decisions

These change what gets built, so they are worth settling before the phase that depends on them. Track B decisions 6 to 13 are in section 20.

1. Phase 7, handover blocking policy. Today three wrong codes typed by the finder permanently block the owner's account. Replace that with blocking the session only, or keep account blocking but target the correct party and make it reversible from the admin UI?
2. Phase 9, status model. Is `Resolved` a distinct state from `Claimed`, or should the verification agent converge on `Claimed`? Related: does the verification-question flow stay at all, given that the handover code flow covers the same need and nothing in the UI calls it?
3. Phase 10, what approval means. A moderation gate before an item is publicly visible, or review of a proposed match? This decides whether a new `moderation` field is added.
4. Phase 8, tag pre-filter. Making it a soft signal instead of a hard gate will produce more matches and more LLM calls. Confirm that trade is acceptable.
5. Phase 5, key rotation. The Groq and Gemini keys have been in the browser bundle, so they must be treated as compromised and rotated. Confirm you can rotate them.

## Track B: architecture, intelligence, and new capability

Track A (phases 0 to 18 above) makes the existing system correct and safe. Track B (phases 19 to 33 below) makes it scalable, intelligent, and defensible as a system design portfolio piece. Track B assumes Track A phases 2, 3, 4, and 14 have landed, because layering, auth, validation, and the error model are prerequisites for everything here.

## 7. Target architecture (HLD)

### 7.1 Where the current design breaks down

| Dimension         | Today                                                                                            | Breaks at                | Root cause                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------ |
| Match latency     | One LLM round trip per candidate, awaited inside the HTTP request                                | ~20 pending items        | O(N) LLM calls, synchronous                            |
| Match cost        | N LLM calls per report, unauthenticated on `/search`                                             | Any traffic              | No retrieval stage, no cache, no cap                   |
| Match quality     | Non-deterministic prose scraped for a number                                                     | Immediately              | No eval set, no ground truth, no metrics               |
| Write reliability | Side effects (email, credits, blockchain, status) run inline and partially, with no compensation | First partial failure    | No outbox, no saga, no idempotency                     |
| Read scale        | Admin screens pull entire collections into the browser                                           | ~5k items                | No pagination, no aggregates, no server-side filtering |
| Availability      | One process does HTTP, matching, embedding, email, and chain writes                              | Any slow dependency      | No worker tier, no bulkheads, no timeouts              |
| Extensibility     | Provider choice is a switch statement with a hardcoded fallback chain                            | Adding a fourth provider | No interface, no registry, no capability routing       |

### 7.2 Target system

Keep a modular monolith for the API. Do not split into microservices: the domain is small, the team is small, and the operational cost of five services would exceed the benefit. Instead enforce module boundaries in code so a split stays possible later.

| Container       | Runtime                                                     | Responsibility                                                         |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Web client      | React 18 and Vite, static hosting                           | UI, PWA shell, optimistic updates                                      |
| API             | Node 20 and Express, modular monolith                       | HTTP, auth, validation, orchestration. No blocking work                |
| Worker          | Node 20, same image, different entrypoint                   | Matching, embeddings, email, chain writes, notifications, outbox drain |
| Queue and cache | Redis, managed                                              | BullMQ queues, rate limit buckets, LLM and embedding cache, hot reads  |
| Primary store   | Firestore                                                   | Items, users, matches, handovers, ledger, chat, inventory, outbox      |
| Vector index    | Firestore native vector search, behind a `VectorIndex` port | Dense retrieval over item embeddings                                   |
| Object store    | Cloudinary                                                  | Item images and derived thumbnails                                     |
| Inference       | In-process ONNX Runtime in Node                             | Text and image embeddings on CPU                                       |
| Vision service  | Python Flask and YOLO, existing                             | CCTV object detection only                                             |
| LLM gateway     | Internal module, multi-provider                             | Rerank, adjudication, enrichment, chat assist                          |
| Chain           | Ethers and Sepolia                                          | Handover attestation, optional, async, best effort                     |

Request path for a new report:

```
POST /api/items
  -> validate, authorize, sanitize
  -> persist item (status Pending, embeddingStatus pending)
  -> write outbox row {type: item.created, itemId} in the SAME transaction
  -> 201 returned to the client immediately

worker: outbox drain
  -> job embed.item        compute text and image vectors on CPU, patch the item
  -> job match.candidates  filter, retrieve top K, rerank, adjudicate
  -> job handover.initiate only for the single best confirmed pair
  -> job notify.*          email, push, in-app
```

Every stage is a durable job with its own retry policy and dead-letter queue. A failure in matching can never fail a report submission, and a failure in email can never lose a handover.

### 7.3 Environments

| Environment | Purpose          | Data                                      | Notes                                              |
| ----------- | ---------------- | ----------------------------------------- | -------------------------------------------------- |
| local       | Development      | Firebase emulator suite and local Redis   | No real keys, no real emails, LLM stubbed or local |
| preview     | Per pull request | Seeded emulator                           | CI deploys, runs the eval harness, tears down      |
| staging     | Pre-release      | Separate Firebase project, synthetic data | Full third-party integration, Sepolia testnet      |
| production  | Live             | Production Firebase project               | Feature flags gate the new matcher                 |

API and worker ship from the same image with different entrypoints so they cannot drift.

### 7.4 Non-functional requirements

| NFR                       | Target                                                   | Measured by                           |
| ------------------------- | -------------------------------------------------------- | ------------------------------------- |
| Report submission p95     | Under 400 ms server time                                 | API histogram, excludes client upload |
| Match completion p95      | Under 20 s from submission                               | Job queue timing                      |
| Match recall@10           | Above 0.90 on the labelled eval set                      | Offline eval in CI                    |
| Match precision@1         | Above 0.80                                               | Offline eval in CI                    |
| Handover verify p95       | Under 300 ms                                             | API histogram                         |
| Chat message delivery p95 | Under 1 s                                                | Client-side timing                    |
| API availability          | 99.5 percent monthly                                     | Uptime probe                          |
| Ledger correctness        | 100 percent, balance always equals the sum of the ledger | Nightly reconciliation job            |
| LLM spend                 | Hard monthly ceiling, alert at 60 percent                | Cost meter per provider               |
| Cold start                | Under 3 s                                                | Deployment probe                      |

### 7.5 Capacity and cost model

Work the numbers before choosing infrastructure. Assumptions to revise with real data:

| Quantity                   | Assumption                                   | Derived                                                                                                            |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Active items               | 10,000                                       | 10,000 vectors at 384 dims and 4 bytes is 15 MB. Fits in memory, so a managed vector database is not yet justified |
| Reports per day            | 200                                          | 200 embed jobs, 200 retrieval queries                                                                              |
| Candidates after filters   | 50 average                                   | Retrieval returns top 20, so 20 pairs reach the reranker                                                           |
| LLM calls per report       | 1 batched rerank plus at most 1 adjudication | 200 to 400 calls per day, against 10,000 or more today                                                             |
| Embedding compute          | 200 text and 400 image per day on CPU        | Seconds of CPU per day, effectively free                                                                           |
| Firestore reads per report | About 60, with filters and indexes           | Against a full-collection scan today                                                                               |

The headline: two-stage retrieval turns an O(N) LLM problem into an O(1) LLM problem. At 10,000 items the current design would make 10,000 LLM calls per report. The target design makes one or two.

## 8. Matching intelligence redesign

### 8.1 The system does not currently do semantic search

Worth stating plainly, because the intent and the implementation diverge. `autoMatch.service.ts` loads every pending opposite-type item and, for each one that survives a tag-overlap gate, sends a prompt to an LLM asking for a 0 to 100 similarity number. `utils/embeddings.ts` contains a real embedding client and a cosine similarity function, and its only caller builds a string, logs it, and throws it away (`routes/items.ts:163`).

So today there are no vectors, no index, and no nearest-neighbour search. There is a linear scan with an LLM in the inner loop. Four consequences:

- Cost and latency scale linearly with corpus size.
- Scores are non-deterministic, so the same pair can match on one run and not the next.
- The number is scraped out of free text by stripping every non-digit character, so a reply of "85/100" parses as 85100 and clamps to a perfect 100 (defect AI-01).
- Item text is user-controlled and interpolated straight into the scoring prompt, so a reporter can write instructions into their own description and set their own match score (defect AI-02).

### 8.2 Target pipeline: filter, retrieve, rerank, adjudicate

Four stages, each narrower and more expensive than the last.

| Stage        | Method                                                                                                       | Candidates in | Candidates out        | Budget                  |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ------------- | --------------------- | ----------------------- |
| 0 Filter     | Firestore query: opposite type, open status, time window, geo bounding box                                   | All           | 50 to 500             | Under 50 ms             |
| 1 Retrieve   | Hybrid: dense KNN over embeddings plus lexical BM25 plus attribute boosts, fused with reciprocal rank fusion | 500           | Top 20                | Under 100 ms, CPU only  |
| 2 Rerank     | One batched LLM call scoring all 20 pairs, or a local cross-encoder                                          | 20            | Top 3 above threshold | 1 to 2 s, one LLM call  |
| 3 Adjudicate | Tool-using agent, top pair only, structured verdict with evidence                                            | 3             | 0 or 1 confirmed      | 3 to 5 s, one agent run |

Stage 3 runs only when stage 2 is confident but not certain, inside a configurable band such as 60 to 85. Above the band the match auto-confirms, below it the candidate is discarded. That keeps the expensive step rare.

Retrieval supplies recall, reranking supplies precision, and the LLM is used once per report instead of once per candidate.

Hybrid retrieval matters here because lost-and-found text is short and full of proper nouns. Dense vectors handle "Apple phone" against "iPhone 13"; lexical search handles a serial number, a name written inside a bag, or a model string that an embedding model will blur. Fuse them rather than choosing.

Replace the current hard tag-overlap gate entirely. It is the single biggest cause of missed matches (defect LOG-09): it drops a true pair before any semantic stage runs, purely on exact token overlap.

### 8.3 Embeddings on CPU

Target: no GPU, no external embedding API on the hot path, single-digit milliseconds per item.

| Concern      | Choice                                                                         | Why                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime      | ONNX Runtime in-process in Node                                                | The API and matching are already Node. Avoids a network hop and a second deploy unit. Keep it behind an `EmbeddingProvider` port so it can move to a sidecar |
| Text model   | A small sentence encoder in the 384-dimension class, MiniLM or BGE-small tier  | 20 to 35 M parameters, tens of milliseconds per text on CPU, 15 MB of vectors at 10k items                                                                   |
| Quantization | int8 dynamic                                                                   | Roughly 3 to 4 times faster for about 1 percent quality loss. Measure both on the eval set before committing                                                 |
| Image model  | A compact CLIP-class image encoder, int8 ONNX                                  | A real visual embedding instead of the current concept-overlap heuristic. Computed once at upload, never at query time                                       |
| Batching     | Embed in batches inside the worker, never in the request path                  | Amortizes per-call overhead                                                                                                                                  |
| Threading    | Pin the OpenMP and ONNX intra-op thread counts to the container CPU allocation | Thread oversubscription is the usual cause of slow CPU inference in containers                                                                               |
| Storage      | Persist vectors on the item document at ingest                                 | An item is embedded once in its lifetime                                                                                                                     |
| Cache        | Content-hash keyed cache in Redis                                              | Re-uploads and edits do not re-embed                                                                                                                         |

Do the same for the vision service. The CCTV pipeline currently loads a medium YOLO checkpoint. Moving to a nano or small variant exported to ONNX or OpenVINO, with a reduced input size and frame sampling instead of every frame, is the difference between a CCTV feature that works on a CPU box and one that does not.

Guardrail: every model choice above must be validated on the eval harness in 8.7 before adoption. Do not swap models on reputation.

### 8.4 Vector index

| Option                         | Pros                                                                                                                     | Cons                                                | Verdict                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------- |
| Firestore native vector search | No new infrastructure, same security model, same transactions, pre-filtering on type, status, and time in the same query | Tied to Firestore, index limits, fewer tuning knobs | Start here                                        |
| Qdrant self-hosted             | Strong CPU performance, rich payload filtering, HNSW tuning, hybrid built in                                             | Another service to run, back up, and secure         | Migrate here if corpus size or latency demands it |
| pgvector                       | Good if the system ever moves to Postgres                                                                                | Implies a full datastore migration                  | Only alongside a datastore decision               |
| Managed vector SaaS            | Zero operations                                                                                                          | Recurring cost, another vendor, data egress         | Not justified at this size                        |

Define a `VectorIndex` port with `upsert`, `deleteById`, and `search(vector, filters, k)`. The Firestore adapter is the first implementation. Nothing above the port knows which store is behind it, so the migration is a one-file change plus a backfill.

Verify that the pinned `firebase-admin` version exposes vector fields and nearest-neighbour queries before committing, and record the finding as ADR 003.

### 8.5 Multimodal matching

Three independent signals, fused with tuned or learned weights rather than the current hand-set constants:

1. Text similarity: dense embedding of name, description, tags, colour, category.
2. Visual similarity: image embedding cosine, replacing the Clarifai concept-overlap heuristic. Keep Clarifai as an optional secondary signal behind the provider interface, not as the primary one.
3. Structured similarity: colour distance in a perceptual space rather than string equality, category match, geo distance, time delta.

Fusion must be honest about missing signals. The current code divides by a hardcoded maximum only when both sides have zero images, so an item that has images while Clarifai is unconfigured is silently penalized by the full image weight (defect LOG-06). Correct rule: compute the denominator from the signals that actually produced a value, and record which signals were available on the match record so a score stays explainable after the fact.

### 8.6 The adjudication agent

Use an agent where the work is genuinely multi-step and needs evidence, not as a wrapper around a single prompt.

- Trigger: stage 2 returns a score inside the uncertainty band.
- Tools: `get_item(id)`, `compare_images(a, b)`, `geo_distance(a, b)`, `time_delta(a, b)`, `search_similar(text, filters)`, `get_claim_history(userId)`.
- Bounded: maximum tool calls, maximum wall clock, maximum tokens. Terminate to "needs human review" on budget exhaustion.
- Output: a strict schema, `{ verdict, confidence, evidence[], contradictions[] }`, validated before use. The agent never writes to the database. It returns a recommendation that deterministic code acts on.
- Auditable: persist the full trace, tools called with arguments and results, tokens, cost, latency, model, prompt version, on the match record so an admin can see why the system decided what it decided.

The same pattern later serves a second agent: a fraud and duplicate-claim reviewer driven by claim velocity and self-match patterns.

### 8.7 Evaluation harness

Without this, no claim that the new matcher is better is defensible. This is also the part that turns the project from an app into an AIML project.

- Build a labelled dataset of item pairs: true matches, hard negatives (same category, different object), and easy negatives. Seed from real resolved handovers, then augment.
- Metrics: recall@k and MRR for retrieval, precision@1 and nDCG for reranking, end-to-end precision and recall at the auto-confirm threshold, plus p95 latency and cost per report.
- Run offline in CI on every change to a prompt, model, weight, or threshold. Fail the build on regression beyond a tolerance.
- Version prompts and model choices as data so a result is reproducible from a run manifest.
- Shadow mode in production first: run the new pipeline beside the old, log both, act on neither, and compare on real traffic before switching. Then a feature-flagged percentage rollout.
- Track online metrics that offline eval cannot see: admin override rate, false-match reports, handover completion rate per score band.

### 8.8 Untrusted content and prompt injection

Item names, descriptions, tags, and chat messages are attacker-controlled and currently flow unescaped into prompts that drive scoring and, downstream, emails and status changes.

- Delimit and label untrusted content explicitly in every prompt, and instruct the model that content inside the delimiters is data and never instructions.
- Never accept free text as a decision. Use structured output, JSON schema or tool calling, and validate the parsed object: score must be an integer 0 to 100, verdict must be an enum member. Reject and retry once, then fail closed.
- Delete the digit-stripping parse entirely.
- Keep a deterministic guard outside the model: a match may not auto-confirm unless the hard filters on distance, time, and type also pass, whatever the model says.
- Strip or neutralize instruction-like patterns in stored text before it reaches a prompt, and log when that fires as a possible abuse signal.
- Apply the same rules to the chat assistant in section 12, where the injection surface is larger.

## 9. AI provider abstraction

Replace the switch statement and hardcoded fallback chain in `utils/llm.ts` with a small provider framework.

Ports:

```
interface ChatProvider {
  readonly id: string;
  readonly capabilities: { vision: boolean; tools: boolean; jsonSchema: boolean; maxContext: number };
  readonly cost: { inputPerMTok: number; outputPerMTok: number };
  chat(req: ChatRequest): Promise<ChatResponse>;
}

interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

interface ImageEmbedder { embedImage(images: Buffer[]): Promise<Float32Array[]>; }
interface VisionProvider { detect(image: Buffer): Promise<Detection[]>; }
```

Router responsibilities, all currently missing:

| Concern                     | Behaviour                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Capability routing          | A request needing tool calling or vision only reaches providers that declare it, instead of failing at the API                   |
| Policy                      | Route by cost, latency, or quality per task. A cheap model for rerank, a stronger one for adjudication                           |
| Health and circuit breaking | Open the breaker after N consecutive failures, half-open probe, automatic recovery. Today one slow provider stalls every request |
| Rate limiting               | Token bucket per provider per minute, shared across workers through Redis                                                        |
| Retry                       | Exponential backoff with jitter, only on retryable status codes, with a total attempt budget                                     |
| Timeout                     | Per-call abort signal, mandatory, no exceptions                                                                                  |
| Caching                     | Cache on a hash of model, prompt, and parameters. Matching re-scores the same pairs constantly                                   |
| Cost metering               | Record tokens and cost per call, per task, per tenant. Enforce daily and monthly ceilings                                        |
| Structured output           | One interface for schema-constrained responses, with per-provider translation                                                    |
| Observability               | One span per call carrying model, tokens, latency, cache hit, retry count, breaker state                                         |

Providers to implement behind the interface, in priority order: the three existing ones (Groq, Gemini, Grok), a local runtime for development and cost-free fallback, and at least two additional hosted providers so failover is meaningful. Adding a provider must be one new file plus a registry entry, with no change to any caller. Confirm current model identifiers and pricing at implementation time rather than hardcoding them from memory.

Configuration moves from a single `aiProvider` string to a per-task policy an admin can edit: `{ task, primary, fallbacks[], model, temperature, maxTokens, timeoutMs, cacheTtl }`. That also fixes the current mismatch where `llm.ts` supports Grok but the settings type rejects it (defect LOG-21).

## 10. Handover redesign

The current flow works when nothing goes wrong and corrupts state when anything does. Track A phase 7 files down the sharp edges. Track B replaces the mechanism.

### 10.1 Explicit state machine

States: `initiated`, `code_issued`, `awaiting_meet`, `verified`, `completed`, `expired`, `cancelled`, `disputed`, `reverted`.

Every transition is a persisted event, not a field mutation:

```
handoverEvents/{id} = { handoverId, from, to, actor, actorRole, reason, metadata, at }
```

Current state is a projection of the event log. This gives a free audit trail, makes disputes resolvable, and makes reverts safe. It also removes the class of bug where a re-trigger silently rewinds a blocked session (defect LOG-11), because a transition from `blocked` back to `code_issued` is simply not in the transition table.

### 10.2 Outbox and saga

Handover completion has five side effects: item status on two documents, match archival, credit awards, the email, and the chain write. Today they are a batch plus three fire-and-forget blocks, so a partial failure leaves inconsistent state.

- Write the state transition and an outbox row in the same Firestore transaction. Nothing else happens inline.
- A worker drains the outbox and dispatches each side effect as its own idempotent job with its own retry and dead-letter queue.
- Each job carries an idempotency key derived from `(handoverId, step)`, so replays are safe.
- Each step declares a compensating action. Failure past the point of no return escalates to an admin queue rather than retrying forever.

### 10.3 Revert and dispute

This is the revert capability, and it must never be a delete.

| Step | Forward action                | Compensation                                                                                       |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Mark code verified            | Emit a `reverted` event, invalidate the code                                                       |
| 2    | Set both items to Claimed     | Restore the prior status from the event log                                                        |
| 3    | Archive the match to history  | Restore the active match record                                                                    |
| 4    | Award credits to both parties | Post reversing ledger entries. Never edit or delete the originals                                  |
| 5    | Write the chain attestation   | The chain is append-only, so write a linked revocation record referencing the original transaction |
| 6    | Send emails                   | Send a correction notice to both parties                                                           |

`revertHandover(handoverId, reason, actorId)` runs step 6 back to step 1, is admin-only, requires a typed reason, is fully audited, and is itself idempotent. A dispute raised by either party within a configurable window freezes the credits, moves the handover to `disputed`, and routes it to an admin queue with the chat transcript attached.

### 10.4 Verification mechanism

- Codes: cryptographically random, HMAC-SHA256 with a server-side pepper, algorithm version stored on the record so old codes still verify after a rotation.
- Attempts: transactional counter with exponential backoff between attempts, capped per session, never blocking a user account (defect LOG-12).
- Prefer a signed, short-lived QR code over typed digits where both parties have the app open, falling back to the 6-digit code.
- Optional proof of handover: a photo and a coarse geotag captured at confirmation, retained for the dispute window.
- Two-party confirmation as a configurable policy: the finder enters the code and the owner confirms receipt, so neither party alone can close a handover.
- Stop putting the finder's raw email address in the owner's email and directing two strangers to meet with no platform record (defect SEC-22). Route contact through the chat module in section 12, and where a real-world meet is needed prefer a staffed collection point from the inventory module in section 13.

## 11. Credit ledger redesign

Track A phase 6 collapses the two divergent stores into one. Track B makes the result a real ledger.

### 11.1 Append-only double-entry ledger

```
creditLedger/{entryId} = {
  userId, delta, reason, refType, refId,
  idempotencyKey,      // unique index: one award per (user, reason, ref)
  balanceAfter,        // materialized for fast reads, verified nightly
  policyVersion,       // which rule set produced this amount
  reversalOf,          // set on a reversing entry
  reversedBy,          // set on the original when reversed
  actorId, actorRole,  // system, admin, or the user
  createdAt
}
```

Rules:

- Balance is never edited in place. Every change is a new entry written in a transaction that also updates the cached balance.
- Corrections are reversing entries. History is immutable, which is what makes disputes and audits possible.
- The idempotency key makes double-awards structurally impossible, replacing the current "check whether a transaction row exists" pattern.
- A nightly reconciliation job recomputes every balance from the ledger and alerts on any drift. This is the correctness NFR in 7.4.

### 11.2 Policy as data

Move `CREDIT_VALUES` out of a TypeScript constant into an admin-editable, versioned policy document. Every ledger entry records the policy version that produced it, so a historical award stays explainable after the values change. Add rules the current constants cannot express: a first-report bonus, streaks, decay on inactivity, category multipliers, and penalties for confirmed false claims and for no-shows.

### 11.3 Abuse resistance

The credit system is the app's incentive surface, so it is the thing that will be gamed.

- Self-match detection: the same user, device, or payment identity on both sides of a handover.
- Velocity limits per user per window, feeding a review queue rather than a hard block.
- Graph analysis for rings of accounts repeatedly matching each other.
- Require a completed handover, never a report, before value is created. Already true for the main awards; keep it true for any new rule.
- Every automated penalty is appealable and reversible through 11.1.

### 11.4 Optional value layer

Only after the ledger is correct: tiers and badges, a redemption catalog, expiry with warning notifications, and transfer or donation of credits between users. Each is a new ledger reason code, not new bookkeeping.

## 12. Match chat with admin supervision

Replaces the current pattern of emailing one user's address to another.

### 12.1 Model

```
conversations/{conversationId} = {
  matchId, participantIds: [ownerId, finderId],
  state: 'open' | 'frozen' | 'closed',
  riskScore, lastMessageAt, createdAt, closedAt
}
conversations/{conversationId}/messages/{messageId} = {
  senderId, senderRole: 'owner' | 'finder' | 'admin' | 'system',
  body, redactions[], attachments[],
  flags[], createdAt, editedAt, deletedAt
}
```

A conversation is created by the system when a match is confirmed, and closed when the handover completes or is cancelled.

### 12.2 Transport

Firestore snapshot listeners, scoped by security rules to the two participants plus admins. No new infrastructure, realtime out of the box, and access rules live in the same place as every other rule. Revisit a dedicated socket tier only if presence, typing indicators, and read receipts at high concurrency justify it. Record the choice as ADR 008.

### 12.3 Admin supervision

- Admins can list every conversation, filtered by risk score, age, and state.
- Admins can read any thread, and can post as a clearly badged moderator.
- Admins can freeze a thread to read-only, close it, or escalate it to a dispute.
- Every admin read of a conversation is itself audit-logged, because reading two users' private messages is a privileged action.

### 12.4 Safety

This is a channel between two strangers about a valuable object, so it needs real controls, not just a message box.

| Control                | Behaviour                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| PII redaction          | Detect and mask phone numbers, emails, and addresses before persistence, unmasked only after the handover is verified and both parties opt in |
| Scam detection         | Pattern and classifier detection for advance-fee, off-platform payment, and shipping scams. Raises the conversation risk score                |
| Abuse classification   | Toxicity and harassment scoring per message, auto-flagged above a threshold                                                                   |
| Off-platform steering  | Flag attempts to move the conversation to another channel, the standard precursor to fraud                                                    |
| Rate and size limits   | Per-user message rate, body length cap, attachment type allowlist and size cap, image scanning                                                |
| Prompt injection       | Chat content is untrusted input to any AI assist feature. Section 8.8 applies in full                                                         |
| Retention              | TTL on closed conversations, with a legal hold for anything under dispute                                                                     |
| Blocking and reporting | Either party can report or block, which freezes the thread and notifies an admin                                                              |

### 12.5 AI assist

- Suggested replies for common exchanges.
- Automatic thread summary in the admin panel, so a moderator does not read sixty messages to triage one report.
- Automatic escalation when the risk score crosses a threshold.
- Optional translation, which matters for a campus or city deployment.

## 13. Inventory and custody module

Today an item is a report. It is never a physical object with a location and a keeper. This module closes that gap and is where the location statistics come from.

### 13.1 Model

```
sites/{siteId}          = { name, address, geo, capacity, contactId, hours }
storageUnits/{unitId}   = { siteId, kind: 'room'|'shelf'|'bin'|'locker', label, capacity, parentId }
inventoryItems/{invId}  = { itemId, siteId, unitId, custodyState, intakeAt, expiresAt, labelCode, condition, photos[] }
custodyEvents/{eventId} = { invId, from, to, actorId, kind: 'intake'|'move'|'handover'|'return'|'dispose'|'audit', note, at }
```

Custody states: `pending_intake`, `stored`, `reserved_for_handover`, `released`, `returned_to_finder`, `disposed`.

Every movement is a custody event. Current location is a projection, exactly as with handover state, so the chain of custody is provable. That matters operationally and legally for found property.

### 13.2 Operations

- Intake: staff scan or generate a QR label, assign a storage unit, photograph the item, and record its condition.
- Move: scan the item, scan the destination unit.
- Reserve: a confirmed match reserves the item so two claimants cannot be sent to the same shelf.
- Release: released only against a verified handover, which links this module to section 10.
- Retention and disposal: an item unclaimed past its retention window enters a disposal workflow with an approval step and a full audit trail. This is a legal requirement for found property in most jurisdictions, and the system has no concept of it today.
- Stock take: periodic reconciliation of the database against the physical shelf, producing a discrepancy report.

### 13.3 Statistics and analytics

Location analytics driven by real custody data rather than report text:

- Items by site, by storage unit, and by category, with occupancy against capacity and alerts at a threshold.
- Ageing buckets (0 to 7, 8 to 30, 31 to 90, over 90 days) per site, driving the retention workflow.
- Loss and find heatmaps from report coordinates, with recovery-rate overlays per zone. This extends the existing `ItemHeatmap` rather than replacing it.
- Funnel metrics: reported, matched, verified, handed over, with drop-off at each step and per-site comparison.
- Time to reunite, by category and by site.
- Match quality: score distribution against actual handover completion, which is the online signal for the eval harness in 8.7.
- Staff throughput: intakes and handovers per person per shift.

All aggregates are precomputed by a scheduled job into a `stats` collection. Dashboards read the aggregate, never the raw collection, which also removes the current full-collection client reads (defect PERF-07).

### 13.4 Additional capability worth considering

Ordered by value against effort:

| Feature                                      | Value  | Effort | Notes                                                                           |
| -------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------- |
| PWA with push notifications                  | High   | Low    | A lost-and-found is a notification product. Push on match beats email           |
| Saved searches and standing alerts           | High   | Low    | Notify a user when a matching item appears later, which is the common real case |
| QR labels and staff scanning                 | High   | Medium | Makes the inventory module usable by real staff                                 |
| Public item board with privacy-safe previews | High   | Medium | Blur or omit identifying detail, require a claim flow to see more               |
| Multi-tenant sites and organizations         | High   | High   | Turns this from one deployment into a product                                   |
| OCR on item images                           | Medium | Low    | Serial numbers and names inside bags are the strongest match signal that exists |
| Duplicate report detection at submission     | Medium | Low    | Reuses the retrieval stage already built in section 8                           |
| Reverse image search for the public          | Medium | Medium | Reuses the image embeddings already computed                                    |
| Scheduled collection appointments            | Medium | Medium | Replaces ad-hoc meets, ties to site hours                                       |
| Anonymous or guest reporting                 | Medium | Medium | Lowers the barrier to reporting a found item                                    |
| Data export and deletion self-service        | Medium | Low    | Required for GDPR and India DPDP compliance                                     |
| SMS and WhatsApp channels                    | Medium | Medium | Higher reach than email in the target market                                    |
| Insurance or police-report export            | Low    | Low    | A one-page PDF of a report for filing                                           |

## 14. Security program

Track A closes the specific holes already found. Track B makes security a repeatable property rather than a one-time sweep, mapped to OWASP so the coverage is arguable rather than assumed.

### 14.1 OWASP API Security Top 10 coverage

| Risk                                                 | Status today                                                                                             | Target control                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| API1 Broken object level authorization               | Failing. Items, handovers, credits, and profile pictures are addressable by id with no ownership check   | A central policy layer. Every read and write of an owned resource passes one `can(actor, action, resource)` check, tested per endpoint |
| API2 Broken authentication                           | Partial. Tokens are verified, but role comes from a claim that is never set                              | Server-side role resolution, token revocation on block, short session lifetime, re-auth for privileged actions                         |
| API3 Broken object property level authorization      | Failing. Item update spreads the request body into the write                                             | Explicit allowlists per endpoint, server-owned fields rejected, enforced by schema not convention                                      |
| API4 Unrestricted resource consumption               | Failing. Unauthenticated endpoints trigger unbounded LLM work, and 10 MB JSON bodies carry base64 images | Per-user and per-IP quotas, cost ceilings per task, request size limits, direct-to-storage uploads instead of base64 in JSON           |
| API5 Broken function level authorization             | Failing. Settings, analytics, and match verification are open                                            | Deny by default at the router. A route without an explicit policy does not start the server                                            |
| API6 Unrestricted access to sensitive business flows | Failing. Credits can be granted directly, and handovers initiated by anyone                              | Business-flow rate limits, idempotency keys, anti-automation on credit-creating paths                                                  |
| API7 Server side request forgery                     | Present. Image URLs are passed to a third-party fetcher and the vision service URL is configurable       | Allowlist outbound hosts, validate and re-host user-supplied URLs, block private address ranges, no user input in an outbound URL      |
| API8 Security misconfiguration                       | Failing. CSP disabled in helmet, Flask debug on a public bind, permissive CORS with credentials          | CSP with nonces, strict CORS origin list, secure header baseline, debug forced off outside development, configuration linted in CI     |
| API9 Improper inventory management                   | Failing. Ten endpoints exist that nothing calls, and there is no versioning                              | OpenAPI as the source of truth, generated client types, a `/v1` prefix, a deprecation policy, dead routes deleted                      |
| API10 Unsafe consumption of third-party APIs         | Failing. No timeouts anywhere, and LLM prose parsed as a decision                                        | Timeouts and circuit breakers on every outbound call, schema validation on every third-party response, never trust an LLM string       |

### 14.2 AI-specific threats

Not covered by the classic list, and directly applicable here.

| Threat                      | Exposure                                                             | Control                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Prompt injection            | High. User-controlled item text drives the match score               | Section 8.8 in full                                                                                                      |
| Model output as authority   | High. A number scraped from prose changes item state and sends email | Structured output, schema validation, deterministic guards outside the model                                             |
| Sensitive data in prompts   | Medium. Item descriptions and emails reach third-party providers     | Minimize fields sent, redact PII before the call, prefer providers with a no-training commitment, document the data flow |
| Cost exhaustion             | High. An unauthenticated endpoint reaches an LLM loop                | Auth, quotas, hard ceilings, alerting                                                                                    |
| Leakage through chat assist | Medium                                                               | The same redaction policy, and no user data in any fine-tune without explicit consent                                    |
| Model supply chain          | Medium. ONNX weights pulled at build time                            | Pin versions, verify checksums, vendor the artifacts, scan them                                                          |

### 14.3 Baseline controls

- Deny-by-default routing: a route must declare a policy or the application refuses to boot.
- Secrets in a managed secret store, never in env files in the repository, with documented rotation. The blockchain key moves to a KMS-backed signer or, at minimum, a dedicated low-value hot wallet with a spend cap and monitoring.
- CSP with nonces, HSTS, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, and a strict CORS allowlist.
- Firestore security rules as a tested artifact, with rules unit tests in CI, not console-managed configuration.
- An append-only audit log for every privileged action: role changes, blocks, credit adjustments, reverts, conversation reads, disposals.
- Dependency and container scanning in CI, an SBOM per release, and automated dependency updates.
- Static analysis and secret scanning on every pull request, blocking on high severity.
- Rate limiting at the edge as well as in the application.
- An incident runbook: what to do when a key leaks, when the LLM bill spikes, when a user reports fraud.
- A threat model reviewed per release and kept in the repository beside the ADRs.

### 14.4 Privacy and compliance

- A data inventory: what personal data exists, where it lives, how long it is kept, and who can read it.
- A retention policy per collection, enforced by TTL jobs, including chat and custody photographs.
- Self-service export and deletion, with documented handling for data that must survive deletion for audit or legal reasons.
- Consent for email and push, recorded with a timestamp and revocable.
- A data processing register listing every third party that receives user data: Cloudinary, Resend, the LLM providers, Clarifai, and the chain.

## 15. Responsiveness, accessibility, and frontend performance

### 15.1 Performance budget

| Metric                    | Budget                                    | Enforcement                              |
| ------------------------- | ----------------------------------------- | ---------------------------------------- |
| Largest Contentful Paint  | Under 2.5 s on a mid-range mobile over 4G | Lighthouse CI on every pull request      |
| Interaction to Next Paint | Under 200 ms                              | Lighthouse CI plus field data            |
| Cumulative Layout Shift   | Under 0.1                                 | Lighthouse CI                            |
| Initial JavaScript        | Under 200 kB gzipped                      | Bundle size check in CI, fails the build |
| Route chunk               | Under 100 kB gzipped                      | Same                                     |

The current build ships a 271 kB gzipped spreadsheet library and a 112 kB charting library. Both belong behind a dynamic import at the point of use, which alone brings the initial payload inside budget.

### 15.2 Responsiveness work

- A mobile-first audit of every screen at 360, 768, 1024, and 1440 pixels. The admin tables and the report modal are the likely failures.
- Virtualized lists for any table that can exceed 100 rows.
- Server-driven pagination and filtering, replacing the current pattern of loading a whole collection and filtering in the browser.
- Skeleton screens instead of spinners, so layout does not shift when data arrives.
- Optimistic updates with rollback for approve, reject, and status changes.
- Responsive images from Cloudinary with automatic format and quality, `srcset` and `sizes`, lazy loading below the fold, and a blurred placeholder.
- Route-level and component-level code splitting, with the map, charts, and export libraries all lazy.
- A PWA shell: installable, offline read of previously seen reports, background sync for a report submitted while offline, and push notifications for match and handover events.

### 15.3 Accessibility

Treat this as a requirement, not a nicety, because a lost-and-found is a public service.

- Every interactive element keyboard reachable, with visible focus.
- Focus trapping and restoration in every modal, of which this app has many.
- Semantic landmarks and headings, labelled form controls, and errors associated with their inputs.
- Contrast at WCAG AA across both themes.
- Respect `prefers-reduced-motion`.
- Automated accessibility checks in CI plus a manual screen-reader pass on the five core flows.

## 16. Low level design

Deliverables to produce and keep in `docs/`, versioned with the code, each referenced from the phase that implements it.

### 16.1 Module boundaries

```
server/src/modules/
  identity/      users, roles, sessions, blocking
  catalog/       items, images, tags, moderation
  matching/      filters, retrieval, rerank, adjudication, eval
  handover/      state machine, codes, events, saga, revert
  ledger/        credits, entries, policies, reconciliation
  inventory/     sites, units, custody, retention, stats
  messaging/     conversations, moderation, safety
  notification/  email, push, in-app, templates, outbox consumers
  intelligence/  provider registry, router, embeddings, cache, cost
  platform/      config, logging, tracing, errors, jobs, outbox
```

Each module exposes a service interface and owns its repositories. Cross-module calls go through the interface, never into another module's repository. A lint rule enforces the boundary so a later split into services stays possible.

### 16.2 Diagrams to produce

| Diagram                                   | Purpose                                                           |
| ----------------------------------------- | ----------------------------------------------------------------- |
| C4 level 1 context                        | The system, its users, and its third parties                      |
| C4 level 2 container                      | Client, API, worker, queue, stores, inference, external services  |
| C4 level 3 component, per module          | Internals of matching, handover, and ledger                       |
| Sequence: report to match                 | Async handoff, outbox, retries                                    |
| Sequence: match to handover to completion | The saga and every compensation                                   |
| Sequence: revert                          | Compensations running in reverse                                  |
| Sequence: chat with moderation            | The safety pipeline inline                                        |
| State machine: handover                   | The transition table from 10.1                                    |
| State machine: item lifecycle             | Resolves the current Claimed against Resolved ambiguity           |
| State machine: custody                    | From 13.1                                                         |
| ER and collection model                   | Every collection, its fields, its indexes, and its access pattern |
| Deployment                                | Environments, network boundaries, secrets flow                    |

### 16.3 Contracts

- OpenAPI 3.1 as the single source of truth for the HTTP surface, with client types generated from it so client and server can no longer drift. That drift is the root cause of four current defects.
- JSON Schema for every LLM structured output and every queue job payload.
- A documented event catalog for outbox and domain events, with versioning rules.

### 16.4 Coding standards to enforce

- Dependency inversion at every boundary: services depend on ports, adapters implement them, composition happens once at startup.
- Constructor injection. No service locators, no module-level singletons holding state.
- Errors as typed domain results at boundaries, exceptions only for the exceptional, one translation layer to HTTP.
- Immutability by default for domain objects.
- No `any`, enforced by lint and blocking in CI.
- Every public service method has a unit test, and every module has a contract test against its port.
- Structured logging with a correlation id threaded from request through queue job to external call.

## 17. Architecture decision records

Keep these in `docs/adr/`, numbered, immutable once accepted, superseded rather than edited. This is the artifact that makes the project read as senior work.

| ADR | Decision                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------- |
| 001 | Modular monolith over microservices, with the boundaries that make a later split possible            |
| 002 | Two-stage retrieve-then-rerank over LLM-per-candidate                                                |
| 003 | Firestore native vector search first, behind a `VectorIndex` port, with the migration trigger stated |
| 004 | CPU ONNX embeddings in-process over a hosted embedding API                                           |
| 005 | A Redis-backed job queue for the worker tier, over a Firestore-polling job table                     |
| 006 | Outbox plus saga with compensations, over two-phase commit or best-effort inline side effects        |
| 007 | Append-only double-entry ledger over a mutable balance field                                         |
| 008 | Firestore listeners for chat over a dedicated socket tier                                            |
| 009 | Event-sourced handover state over field mutation                                                     |
| 010 | Provider-agnostic AI interface with capability routing, over a hardcoded fallback chain              |
| 011 | Structured output and deterministic guards, over parsing model prose                                 |
| 012 | Firestore retained as the primary store, with the conditions that would justify revisiting it        |

## 18. Track B phase plan

Each phase is one branch cut from `develop`, same protocol as Track A. Track B assumes Track A phases 2, 3, 4, and 14 have landed.

| Phase | Branch                                        | Delivers                                                                                                                                                     | Depends on       | Status |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------ |
| 19    | `docs/reclaim-219-hld-lld-adr`                | Sections 7, 16, and 17 as real artifacts in `docs/`: C4 diagrams, sequences, state machines, ER model, OpenAPI skeleton, ADRs 001 to 012                     | Track A phase 14 | [ ]    |
| 20    | `feat/reclaim-220-platform-jobs-outbox`       | Redis, job queue, worker entrypoint, outbox collection and drainer, idempotency keys, dead-letter queues, tracing across the boundary                        | 19               | [ ]    |
| 21    | `refactor/reclaim-221-ai-provider-interface`  | Section 9 in full: ports, registry, capability routing, breaker, quotas, cache, cost meter, structured output, two additional providers plus a local runtime | 20               | [ ]    |
| 22    | `feat/reclaim-222-embeddings-cpu`             | Section 8.3: ONNX text and image embedding on CPU, quantized, batched, cached, with a backfill job for existing items                                        | 21               | [ ]    |
| 23    | `feat/reclaim-223-vector-retrieval`           | Section 8.4 plus the filter and retrieve stages, hybrid dense and lexical with rank fusion, behind a feature flag in shadow mode                             | 22               | [ ]    |
| 24    | `feat/reclaim-224-rerank-and-eval`            | Section 8.2 stage 2 and section 8.7: batched reranking, the labelled dataset, offline metrics in CI, shadow comparison against the current matcher           | 23               | [ ]    |
| 25    | `feat/reclaim-225-adjudication-agent`         | Section 8.6: bounded tool-using agent, structured verdict, full trace persisted, admin-visible reasoning. Retires the LLM-per-candidate path                 | 24               | [ ]    |
| 26    | `refactor/reclaim-226-handover-state-machine` | Section 10: event-sourced state machine, saga over the outbox, compensations, QR verification, two-party confirmation                                        | 20               | [ ]    |
| 27    | `feat/reclaim-227-revert-and-dispute`         | Section 10.3: admin revert, dispute flow, freeze, adjudication queue, correction notices                                                                     | 26               | [ ]    |
| 28    | `refactor/reclaim-228-credit-ledger`          | Section 11: append-only double-entry ledger, idempotency, policy as data, nightly reconciliation, abuse rules                                                | 20, 26           | [ ]    |
| 29    | `feat/reclaim-229-match-chat`                 | Section 12: conversations, realtime, moderation console, safety pipeline, retention                                                                          | 26               | [ ]    |
| 30    | `feat/reclaim-230-inventory-custody`          | Sections 13.1 and 13.2: sites, storage units, custody events, intake and release, QR labels, retention and disposal                                          | 26               | [ ]    |
| 31    | `feat/reclaim-231-inventory-analytics`        | Section 13.3: precomputed aggregates, location statistics, funnel and ageing dashboards, replacing client-side collection scans                              | 30               | [ ]    |
| 32    | `feat/reclaim-232-security-program`           | Section 14 beyond Track A: policy layer, SSRF allowlists, CSP, rules tests, audit log, supply chain scanning, threat model, privacy tooling                  | 21               | [ ]    |
| 33    | `perf/reclaim-233-frontend-responsiveness`    | Section 15: budgets in CI, virtualization, server pagination, responsive images, PWA with push, accessibility pass                                           | 31               | [ ]    |

If the whole track is too much at once, the minimum sequence that delivers the scalability and quality story is 19, 20, 22, 23, 24. Then 26, 27, 28 for reliability. Then 29, 30, 31 for new capability. Phases 21, 32, and 33 can interleave.

## 19. Additional defects found during the architecture pass

| #   | ID      | Sev | Defect                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                       | Phase | Branch                                | Status |
| --- | ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- | ------------------------------------- | ------ |
| 102 | AI-01   | S2  | The LLM score is parsed by stripping every non-digit character from the reply, which concatenates all remaining digits. A response of "85/100" parses as 85100 and clamps to a perfect 100, and "I rate this 7 out of 10" parses as 710 and also clamps to 100. Any model that does not answer with a bare number produces a false maximum score. | `server/src/services/autoMatch.service.ts:109`; `server/src/services/matching.ts:81`           | 24    | `feat/reclaim-224-rerank-and-eval`    | [ ]    |
| 103 | AI-02   | S1  | Prompt injection. Item `name`, `description`, and `tags` are attacker-controlled and interpolated directly into the scoring prompt with no delimiting and no instruction hierarchy. A reporter can place instructions in their own description and set their own match score, which then drives handover emails and item status changes.          | `server/src/services/autoMatch.service.ts:72-101`; `server/src/services/matching.ts:57-74`     | 25    | `feat/reclaim-225-adjudication-agent` | [ ]    |
| 104 | AI-03   | S3  | `utils/embeddings.ts` implements a full embedding client and cosine similarity that nothing uses. Its only caller builds the embedding string, logs it, and discards it, so the semantic retrieval the code was written for was never wired up.                                                                                                   | `server/src/utils/embeddings.ts`; `server/src/routes/items.ts:163-171`                         | 22    | `feat/reclaim-222-embeddings-cpu`     | [ ]    |
| 105 | SEC-22  | S2  | The handover email sends the finder's raw email address to the owner and instructs the two strangers to meet in person at an address, with no platform-mediated channel and no record of the exchange. That is both an unnecessary PII disclosure and a personal-safety gap.                                                                      | `server/src/services/email.ts:386-452`                                                         | 29    | `feat/reclaim-229-match-chat`         | [ ]    |
| 106 | SEC-23  | S2  | Server-side request forgery surface. Clarifai is handed image URLs read from item documents, and the CCTV proxy forwards to a `YOLO_SERVICE_URL` read from configuration. Any path that lets a user influence either value reaches an outbound fetch with no host allowlist and no private-range block.                                           | `server/src/services/clarifaiMatch.service.ts:160-175`; `server/src/routes/cctv.ts:8,13,31,64` | 32    | `feat/reclaim-232-security-program`   | [ ]    |
| 107 | SEC-24  | S2  | `helmet` is configured with `contentSecurityPolicy: false`, so the application ships no content security policy at all.                                                                                                                                                                                                                           | `server/src/app.ts:59-62`                                                                      | 32    | `feat/reclaim-232-security-program`   | [ ]    |
| 108 | SEC-25  | S3  | `ADMIN_PRIVATE_KEY` is read from a plain environment variable and used to sign live transactions, with no key management, no spend cap, and no monitoring.                                                                                                                                                                                        | `server/src/services/blockchain.service.ts:74,99`                                              | 32    | `feat/reclaim-232-security-program`   | [ ]    |
| 109 | ARCH-19 | S3  | No API versioning and no machine-readable contract, which is the direct cause of defects UI-05, UI-06, UI-07, and UI-08, where client and server disagree about a field name or an enum value.                                                                                                                                                    | `server/src/app.ts:102-111`                                                                    | 19    | `docs/reclaim-219-hld-lld-adr`        | [ ]    |

Running totals after part two: 109 findings. S1: 22. S2: 44. S3: 33. S4: 10.

## 20. Track B open decisions

These change the shape of the build, so settle them before the phase that depends on them.

| #   | Decision              | Options                                                                       | Recommendation                                                                                                                                         | Blocks |
| --- | --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 6   | Worker infrastructure | Redis plus a job library, a cloud task queue, or a Firestore-polled job table | Redis plus a job library. Retries, backoff, dead-letter queues, and scheduling come for free, and Redis also serves cache and rate-limit buckets       | 20     |
| 7   | Vector store          | Firestore native vector search, or self-hosted Qdrant                         | Firestore first, behind a port. No new infrastructure and the same security model. Migrate on measured need                                            | 23     |
| 8   | Embedding runtime     | In-process ONNX in Node, or a Python sidecar beside the YOLO service          | In-process Node. No extra hop, no extra deploy unit, and the matching code is already Node                                                             | 22     |
| 9   | Auto-confirm policy   | Fully automatic above a threshold, or admin approval on every match           | Automatic above a high band, admin review inside the uncertainty band, never automatic below it. Section 8.2                                           | 24     |
| 10  | Chat transport        | Firestore listeners, or a dedicated socket service                            | Firestore listeners. Realtime with no new infrastructure and rule-based access control                                                                 | 29     |
| 11  | Inventory scope       | Full custody tracking with sites and units, or location statistics only       | Full custody. Statistics without custody data are derived from report text and will be wrong                                                           | 30     |
| 12  | Chain attestation     | Keep Sepolia, move to a managed signer, or drop the chain                     | Decide explicitly. If it stays it needs key management and a revocation record for reverts. If it is a demo feature, say so in an ADR and cap the risk | 27     |
| 13  | Multi-tenancy         | Single deployment, or organizations and sites as first-class tenants          | Design the schema for tenancy now, even if only one tenant exists. Retrofitting a tenant key later is a full migration                                 | 30     |

## Track C: CCTV rebuild, production toolchain, interview readiness

## 21. CCTV subsystem rebuild

The CCTV feature is the weakest subsystem in the project, and it is also the one an interviewer will ask about most, because it is the only computer-vision component. It needs a rebuild rather than a repair. This section covers what is wrong, what it should be, and how to get there.

### 21.1 Assessment

Thirty separate defects are catalogued in section 24. They cluster into five failures:

| Failure                             | Symptom the user sees                                                 | Cause                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong taxonomy                      | Selecting "wallet", "keys", or "watch" detects nothing, ever          | The class list offered in the UI includes labels that are not in the model's vocabulary at all                                                             |
| Broken confidence units             | Analysis reports "1% match confidence" on a clean detection           | A 0-to-1 float is rendered as a percentage, and the same mislabelled value is fed to the language model, which then reasonably concludes there is no match |
| Video upload does not complete      | Spinner sits at 40 percent, then a generic failure, or nothing at all | Frame extraction can hang forever, can silently return an empty array, and when it does succeed it produces a payload larger than the server body limit    |
| Analysis exceeds the request budget | The request dies before a result comes back                           | Frames are processed one at a time, synchronously, inside the HTTP request, with no timeout anywhere in the chain                                          |
| Detection is not identification     | A "match" only means some object of that category was on camera       | The pipeline never compares the detected object to the specific lost item                                                                                  |

The last one is the important one, and it is a design gap rather than a bug.

### 21.2 The core misconception: detection is not re-identification

The feature is currently built as an object detector. The admin picks a category, the model finds objects of that category, and the UI presents them as candidates. But the product question is not "was a backpack visible on this camera". It is "was **this** backpack, the one in the lost report, visible on this camera".

Those are different problems. The first is object detection, which YOLO does. The second is **re-identification**, which requires comparing the appearance of a detected object against a reference image of the specific item.

The good news is that the redesign in section 8 already builds the missing piece. Phase 22 produces image embeddings for every reported item. Re-identification is then:

```
detect objects in frame  ->  crop each detection
  ->  embed each crop with the same image encoder used for items
  ->  cosine similarity against the lost item's stored image embedding
  ->  rank sightings by similarity, not by detector confidence
```

This reuses infrastructure that already has to exist, costs nothing extra at query time, and turns a category filter into an actual search. It is also the single most defensible thing in the project to talk about in an interview, because it is a real modelling decision with a clear before and after.

### 21.3 Target pipeline

| Stage                | Runs on                  | Responsibility                                                                                         |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1 Ingest             | Client to object storage | Video uploaded directly to Cloudinary or equivalent. The API never receives video bytes                |
| 2 Decode and sample  | Worker                   | Server-side frame extraction at an adaptive rate, downscaled, with a hard frame cap                    |
| 3 Detect             | Vision service           | Batched inference over frames, configurable confidence and image size                                  |
| 4 Track              | Vision service           | Multi-object tracking so one physical object across many frames becomes one track, not many detections |
| 5 Re-identify        | Worker                   | Embed the best crop per track, compare against the target item's embedding                             |
| 6 Rank and summarise | Worker                   | Rank tracks by similarity, pick a representative keyframe per track, generate the narrative            |
| 7 Report             | API and client           | Progress events during the run, a structured result at the end                                         |

Every stage after ingest runs in the worker tier from section 7, as a job. The HTTP request that starts an analysis returns a job id immediately. The client subscribes to progress. This alone fixes the timeout class of failure, which is the most common way the feature fails today.

### 21.4 Model strategy

| Concern        | Today                                                                   | Target                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocabulary     | Fixed 80-class detector, whose labels do not include most lost property | Open-vocabulary detection so an admin can search for an arbitrary object description, with the fixed detector retained as a fast first pass |
| Model size     | A medium checkpoint on CPU                                              | Nano or small variant, exported to ONNX or OpenVINO, int8 quantized. Benchmark before and after on the same clip                            |
| Identification | None                                                                    | Image-embedding re-identification per section 21.2                                                                                          |
| Tracking       | None                                                                    | A standard tracker so detections become tracks                                                                                              |
| Thresholds     | Hardcoded at 0.3                                                        | Configurable per deployment, tuned against a labelled clip set                                                                              |
| Class matching | Bidirectional substring match, so "car" also matches "carrot"           | Exact match against a validated vocabulary, with the UI only offering labels the model actually supports                                    |
| Evaluation     | None                                                                    | A small labelled clip set with precision, recall, and mean time per frame, run in CI exactly like section 8.7                               |

The open-vocabulary upgrade is optional and should be gated on the evaluation set showing it beats the fixed detector plus re-identification. Do not adopt it because it is newer. The fallback plan, fine-tuning the existing detector on a lost-property taxonomy, is cheaper and may well win.

### 21.5 Video ingestion redesign

The current path is: extract every frame in the browser, base64 them, and post the lot as one JSON body. That fails on payload size, on request duration, and on browser memory, in that order.

Target:

- The browser uploads the raw video file directly to object storage with a signed URL. No base64, no JSON envelope, no server memory.
- The client calls `POST /api/cctv/analyses` with the storage reference, the target item id, and options. The API validates, enqueues a job, and returns `202` with an analysis id.
- The worker downloads, decodes, and samples server-side, where frame rate, resolution, and count are controlled rather than whatever the browser produced.
- Sampling is adaptive: a coarse pass first, then a dense pass only around segments that produced hits.
- Progress is published per stage, and the client subscribes rather than polling.
- Results persist as an `analyses` document, so a run survives a page reload, can be revisited, shared with another admin, and re-run against a different target without re-uploading.

Hard limits to enforce and surface in the UI before upload starts: maximum file size, maximum duration, accepted container and codec list, and maximum frames per analysis.

### 21.6 Live mode redesign

Live webcam mode has different problems from upload mode. It currently posts a full-resolution frame to the server every four seconds, forever, including when the browser tab is hidden.

- Run detection in the browser via ONNX Runtime Web where the device allows it, and fall back to the server path otherwise. This removes the network round trip entirely and makes the overlay responsive rather than a four-second slideshow.
- Downscale before inference. A detector does not need 1080p.
- Pause on `visibilitychange` and on window blur.
- Adaptive interval: back off when nothing is detected, speed up when something is.
- Fix the overlay geometry. The video is letterboxed by `object-contain` inside a 16:9 container while the canvas is stretched to fill it, so boxes do not line up with what they are boxing. The canvas must match the video's rendered content box, recomputed on resize.
- Clear the overlay when a scan returns nothing, rather than leaving the previous frame's boxes painted over live video.
- Let the best-detection panel decay. A detection that has not been seen for N scans is stale and must not still be offering a Register button.

### 21.7 UI rebuild

The screen is 836 lines containing camera control, upload, analysis, results, and item registration. Split it and fix the reporting while doing so.

Components: `CctvPage` shell, `TargetSelector`, `LiveCameraPanel`, `DetectionOverlay`, `VideoUploadPanel`, `AnalysisProgress`, `AnalysisResults`, `KeyframeTimeline`, `SightingCard`, `RegisterFoundDialog`. Hooks: `useCamera`, `useDetectionLoop`, `useVideoAnalysis`, `useYoloVocabulary`.

Reporting fixes, which is the "does not report proper details" complaint:

| Problem                                                  | Fix                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Confidence shown as "1%"                                 | Normalise units once, at the service boundary, and assert the range. Never let a 0-to-1 float and a 0-to-100 percentage share a field name |
| Only two of four stats displayed                         | Show frames analysed, frames with hits, tracks found, best similarity, mean similarity, and wall-clock time                                |
| Keyframe count capped at ten and mislabelled             | Report the true count, paginate the gallery, and label the capped list as a sample                                                         |
| Keyframes ordered by confidence, presented as a timeline | Order chronologically, and offer a separate ranked view                                                                                    |
| Timestamp labels render in the wrong place               | The label is absolutely positioned inside a button that is not a positioning context                                                       |
| Fake progress bar                                        | Drive it from real per-stage job progress                                                                                                  |
| No empty state                                           | A run that finds nothing must say so plainly, not show a green tick and 0 percent                                                          |
| Cannot re-run on the same video                          | Keep the uploaded video and allow a new target without re-uploading                                                                        |
| Camera permission denial is silent                       | Surface a real error with a recovery action                                                                                                |
| Registration silently no-ops when a crop is missing      | Disable the control and explain why                                                                                                        |

Every sighting card should show: the crop, the full frame, the timestamp, the camera or file, the detector confidence, the re-identification similarity, and a one-line rationale. That is what "proper details" means here.

### 21.8 CPU performance targets

Benchmark before changing anything, then hold these as the acceptance criteria:

| Metric                      | Target on a 2-core CPU container                                                 |
| --------------------------- | -------------------------------------------------------------------------------- |
| Single-frame detection      | Under 150 ms at reduced input size, int8                                         |
| Live overlay                | At least 2 updates per second in browser mode                                    |
| Video analysis throughput   | At least 10 sampled frames per second in the worker, batched                     |
| 10-minute clip, coarse pass | Under 2 minutes wall clock                                                       |
| Vision service memory       | Under 1 GB resident                                                              |
| Model load                  | Under 10 seconds cold, with the health endpoint reporting not-ready until loaded |

The health endpoint currently reports `ok` even when the model failed to load. Fix that first, because every other measurement is meaningless if the service lies about readiness.

## 22. Production toolchain and operational readiness

This is the layer that separates a project that runs on a laptop from one that reads as production software.

### 22.1 Build and packaging

- Multi-stage Dockerfiles for API, worker, and vision service. Non-root user, pinned base images, minimal runtime layer, `HEALTHCHECK` defined.
- `docker compose` for local development bringing up API, worker, Redis, the Firebase emulator suite, and the vision service with one command. A new contributor should be productive without a cloud account.
- API and worker built from the same image with different entrypoints so they cannot drift.
- Model weights vendored or pulled at build time with a checksum, never downloaded on first request. The current vision service downloads its checkpoint at startup if it is missing, which makes cold start unpredictable.

### 22.2 Infrastructure and configuration as code

- Firestore rules and indexes committed and deployed from CI, never edited in a console.
- Infrastructure defined declaratively, including the Redis instance, service accounts, and IAM bindings.
- A versioned migration runner with an applied-migrations collection, forward and reverse scripts, and a dry-run mode. Several Track A and B phases require data migrations, and doing them by hand is how production data gets damaged.
- Environment configuration validated at boot by the typed config module from Track A phase 2. No implicit defaults for anything that matters.

### 22.3 CI/CD

Pipeline stages, all blocking on the main branch:

| Stage                        | Gate                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| Lint and format              | Zero errors                                                                 |
| Type check                   | Zero errors, no `any`                                                       |
| Unit tests                   | Pass, with a coverage floor on service and domain code                      |
| Integration tests            | Pass against the Firebase emulator                                          |
| Security                     | Dependency audit, secret scan, container scan, SBOM generated               |
| Matching evaluation          | Recall and precision within tolerance of the recorded baseline              |
| Build                        | Both packages, plus images                                                  |
| Bundle budget                | Initial JavaScript within the section 15 budget                             |
| Accessibility and Lighthouse | Within the section 15 budget                                                |
| Deploy                       | Preview per pull request, staging on merge, production behind a manual gate |

Conventional commits, generated changelog, and tagged releases. Preview environments torn down on merge.

### 22.4 Observability

`@opentelemetry/api` is already a dependency and is unused. Make it real.

- Distributed tracing with one trace spanning HTTP request, queue job, external API call, and database write, correlated by a request id propagated end to end.
- Metrics in two families: RED metrics per endpoint and per job, and business metrics that actually matter here, which are match rate, time to reunite, handover completion rate, LLM cost per report, and detection throughput.
- Structured JSON logs with the redaction policy from Track A phase 2, shipped to a queryable store, never `console.log`.
- Error tracking with release tagging and source maps.
- Dashboards per subsystem and SLO burn-rate alerts tied to the targets in section 7.4, so an alert means something is actually wrong.
- Synthetic probes exercising the five core workflows against production on a schedule.

### 22.5 Testing strategy

| Level       | Scope                                                                           | Where             |
| ----------- | ------------------------------------------------------------------------------- | ----------------- |
| Unit        | Pure logic: scoring, state machines, ledger arithmetic, fusion, unit conversion | Both packages     |
| Contract    | Every module against its port, and the client against the OpenAPI schema        | Server and client |
| Integration | Core workflows against the Firebase emulator with real rules                    | Server            |
| Rules       | Firestore security rules unit tests, including negative cases                   | Server            |
| End to end  | The five regression-matrix workflows in a browser                               | Playwright        |
| Evaluation  | Matching quality and CCTV detection quality against labelled sets               | CI                |
| Load        | Report submission and match throughput at target concurrency                    | k6                |
| Resilience  | Provider outage, Redis outage, vision service outage, all degrading gracefully  | Scheduled         |

Regression tests are named after the defect IDs in this document, so a fix cannot silently revert.

### 22.6 Operational documentation

- Runbooks: key leak, LLM cost spike, queue backlog, vision service down, fraud report, handover dispute.
- An architecture overview and a "how to add a provider" guide, both kept next to the ADRs.
- Published API documentation generated from the OpenAPI specification.
- An on-call escalation path, even if it is one person, because writing it down is the point.

## 23. Interview readiness

The goal is to be able to defend every decision in this repository under questioning. That means the artifacts have to exist, and the numbers have to be measured rather than asserted.

### 23.1 The narrative

Four beats, in this order. It works because it is true and because it shows judgement rather than enthusiasm.

1. **A working prototype existed.** Auth, reporting, matching, handover, CCTV, and credits all had code and the build was green.
2. **Measurement found 139 defects**, including 24 that were exploitable without authentication and a live prompt-injection path that let a user set their own match score. A green build proves nothing about correctness.
3. **They were fixed in dependency order**, behind a regression matrix, with client and server contract changes landing in the same commit. Not a rewrite.
4. **Then the parts that could not scale were replaced.** The matcher went from one language-model call per candidate to a retrieve-then-rerank pipeline with an offline evaluation harness. The measured result is the claim, not the architecture diagram.

### 23.2 Numbers to be able to quote

Fill these in as the work lands. Empty cells are worse than modest numbers.

| Metric                                       | Before                               | After | Where measured      |
| -------------------------------------------- | ------------------------------------ | ----- | ------------------- |
| Defects found, by severity                   | 139 total, 24 S1                     |       | Sections 1, 19, 24  |
| Language-model calls per report at 10k items | ~10,000                              |       | Section 7.5         |
| Match p95 latency                            |                                      |       | Job queue timing    |
| Recall@10 and precision@1                    | no baseline existed                  |       | Evaluation harness  |
| Cost per report                              |                                      |       | Provider cost meter |
| Report submission p95                        |                                      |       | API histogram       |
| Initial JavaScript bundle                    | ~271 kB gzipped in one library alone |       | CI bundle check     |
| CCTV frames per second on CPU                |                                      |       | Vision benchmark    |
| Test coverage on domain code                 | 0 percent                            |       | CI                  |

### 23.3 Questions to be ready for

| Question                                                                   | Where the answer lives                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Why a modular monolith and not microservices                               | ADR 001                                                                                                          |
| How do you keep two writes consistent across Firestore, email, and a chain | Section 10.2, outbox and saga, ADR 006                                                                           |
| How do you undo a completed handover                                       | Section 10.3, compensations, ADR 007                                                                             |
| Why not just use a bigger model                                            | Section 8.2, retrieval is where recall comes from, and the evaluation harness proves it                          |
| How do you know your matcher improved                                      | Section 8.7, and the numbers in 23.2                                                                             |
| What happens when the language-model provider is down                      | Section 9, circuit breaker, fallback chain, local runtime                                                        |
| How do you stop a user gaming the credit system                            | Sections 11.1 and 11.3, idempotency and self-match detection                                                     |
| What is your worst security bug and how did you find it                    | Prompt injection, AI-02. Found by tracing user-controlled data into the prompt                                   |
| Why is your vector store Firestore and not Pinecone                        | ADR 003 and the capacity model in 7.5                                                                            |
| How would you scale this ten times                                         | Section 7.5 first, then the migration triggers named in the ADRs                                                 |
| What would you do differently                                              | Contract-first with OpenAPI from day one. Four current defects are client and server disagreeing on a field name |

### 23.4 Demo script

Roughly twelve minutes, in this order:

1. The problem and the shape of the system, from the C4 container diagram.
2. Report a lost item. Show the 201 returning immediately and the match arriving asynchronously.
3. Open the trace for that report, spanning API, queue, embedding, retrieval, rerank.
4. Show the evaluation harness output and the before-and-after numbers.
5. Show the admin match review, then the handover, then a revert, then the ledger showing the reversing entry rather than a deletion.
6. Show the CCTV re-identification finding a specific item, not just a category.
7. Show one ADR and explain why the decision could go the other way.

Practice the failure paths too. Being able to kill Redis and show the system degrade gracefully is worth more than a flawless happy path.

### 23.5 What not to claim

- Do not call it microservices. It is a modular monolith, on purpose, and saying so is the stronger answer.
- Do not call the matcher an agent end to end. One bounded step is agentic; the rest is retrieval and ranking, which is the correct design.
- Do not quote a metric that was not measured on the evaluation set.
- Do not present the blockchain component as a security control. It is an append-only attestation, and it is the weakest part of the system to be questioned on.
- Do not claim production traffic the project has not served.

## 24. Master defect register, part three: CCTV subsystem

| #   | ID      | Sev | Defect                                                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                             | Phase | Branch                                 | Status |
| --- | ------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------- | ------ |
| 110 | CCTV-01 | S2  | The UI class list offers `wallet`, `keys`, and `watch`, none of which exist in the detector's vocabulary. Selecting them detects nothing, ever, with no error, which reads to the user as a broken model.                                                                                                                                                                                    | `client/src/services/cctvService.ts:79-83`                                                                           | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 111 | CCTV-02 | S2  | Confidence unit mismatch. The vision service returns a 0-to-1 float, the API passes it through as `matchConfidence`, and the UI renders it with `Math.round` as a percentage, so a 0.87 detection displays as 1 percent. The same mislabelled value is interpolated into the language-model prompt as "0.87%", so the model is told confidence is near zero and reasonably reports no match. | `models/app.py:190-199`; `server/src/routes/cctv.ts:76,88-90`; `client/src/pages/admin/CCTVIntelligence.tsx:709-718` | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 112 | CCTV-03 | S2  | `extractFramesFromVideo` drives seeking through a single `onseeked` handler with no timeout and no reject path. If any seek fails to fire the event, the promise never settles and the analysis hangs forever with the progress bar stuck.                                                                                                                                                   | `client/src/services/cctvService.ts:113-152`                                                                         | 35    | `feat/reclaim-235-cctv-video-pipeline` | [ ]    |
| 113 | CCTV-04 | S2  | The same function reads `videoElement.duration` without waiting for `loadedmetadata`. Clicking Analyze before metadata loads yields `NaN`, which resolves to an empty array and surfaces as "Could not extract frames from video".                                                                                                                                                           | `client/src/services/cctvService.ts:120-124`                                                                         | 35    | `feat/reclaim-235-cctv-video-pipeline` | [ ]    |
| 114 | CCTV-05 | S1  | No cap on frame count or frame resolution. Frames are captured at full source resolution and posted as one base64 JSON body. A ten-minute 1080p clip at the default five-second interval produces roughly 120 frames of about 300 kB, far exceeding the 10 MB body limit, so the request is rejected outright.                                                                               | `client/src/services/cctvService.ts:127-129,145`; `server/src/app.ts:89`                                             | 35    | `feat/reclaim-235-cctv-video-pipeline` | [ ]    |
| 115 | CCTV-06 | S2  | `/analyze-video` runs inference one frame at a time in a Python loop, synchronously, inside the HTTP request, with no batching and no timeout at any hop. On CPU this routinely exceeds platform request limits, so the analysis dies without returning a result.                                                                                                                            | `models/app.py:139-190`; `server/src/routes/cctv.ts:64-73`                                                           | 35    | `feat/reclaim-235-cctv-video-pipeline` | [ ]    |
| 116 | CCTV-07 | S2  | The detection overlay is misaligned. The video is letterboxed by `object-contain` inside a 16:9 container while the canvas is stretched to fill that container, so for a 4:3 webcam the boxes do not line up with the objects they bound.                                                                                                                                                    | `client/src/pages/admin/CCTVIntelligence.tsx:648-657`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 117 | CCTV-08 | S2  | When a scan returns zero detections the code skips both `setDetections` and `drawDetections`, so the previous scan's boxes stay painted over live video after the object has left the frame.                                                                                                                                                                                                 | `client/src/pages/admin/CCTVIntelligence.tsx:174-192`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 118 | CCTV-09 | S2  | `bestDetection` only ever increases and is reset solely on a category change, so the panel keeps showing a stale high-confidence result and offering Register as Found for an object that is no longer present.                                                                                                                                                                              | `client/src/pages/admin/CCTVIntelligence.tsx:182-189`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 119 | CCTV-10 | S2  | `drawDetections` calls `clearRect` and then assigns `canvas.width` and `canvas.height`, which itself resets the drawing context. The clear is dead code and the sequence is inverted, so the canvas is resized on every frame for no reason.                                                                                                                                                 | `client/src/pages/admin/CCTVIntelligence.tsx:126-136`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 120 | CCTV-11 | S3  | Target class filtering uses a bidirectional substring test, so selecting `car` also returns `carrot` detections, and any label that is a substring of another produces false positives.                                                                                                                                                                                                      | `models/app.py:90-92,152-153`                                                                                        | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 121 | CCTV-12 | S3  | The confidence threshold is hardcoded at 0.3 in two places, is not configurable per deployment, and is low enough to produce a steady stream of false positives.                                                                                                                                                                                                                             | `models/app.py:95,156`                                                                                               | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 122 | CCTV-13 | S2  | Keyframes are sorted by confidence and then truncated to ten, but the UI presents them as a timeline with timestamps. The sequence shown is not chronological, so the operator cannot follow the object through the footage.                                                                                                                                                                 | `models/app.py:192-193`; `client/src/pages/admin/CCTVIntelligence.tsx:588-601`                                       | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 123 | CCTV-14 | S3  | `averageConfidence` is computed only across frames that produced a detection, not across all analysed frames, so it systematically overstates detection quality.                                                                                                                                                                                                                             | `models/app.py:180-190`                                                                                              | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 124 | CCTV-15 | S2  | The health endpoint returns `{"status": "ok"}` even when the model failed to load and `model` is `None`, so an orchestrator will route traffic to a service that 500s on every request.                                                                                                                                                                                                      | `models/app.py:17-32,47-49`                                                                                          | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 125 | CCTV-16 | S3  | `handleRegisterFromKeyframe` takes `keyframe.detections[0]` assuming it is the best detection, but detections are appended in model output order, not sorted by confidence, so an arbitrary object from the frame is registered.                                                                                                                                                             | `client/src/pages/admin/CCTVIntelligence.tsx:312-314`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 126 | CCTV-17 | S3  | `URL.createObjectURL` is called on every video selection and never revoked, leaking the full video blob per upload for the lifetime of the page.                                                                                                                                                                                                                                             | `client/src/pages/admin/CCTVIntelligence.tsx:325-333`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 127 | CCTV-18 | S3  | No validation of video type, size, duration, or codec before upload. The only guard is the `accept` attribute, which is advisory.                                                                                                                                                                                                                                                            | `client/src/pages/admin/CCTVIntelligence.tsx:325-333`                                                                | 35    | `feat/reclaim-235-cctv-video-pipeline` | [ ]    |
| 128 | CCTV-19 | S3  | The progress bar is fabricated: 10, then 40, then 100. It sits at 40 for the entire server call, which is the only part that actually takes time.                                                                                                                                                                                                                                            | `client/src/pages/admin/CCTVIntelligence.tsx:341-361`                                                                | 35    | `feat/reclaim-235-cctv-video-pipeline` | [ ]    |
| 129 | CCTV-20 | S3  | The Analyze button is hidden once a result exists, so the same video cannot be re-analysed for a different target class without discarding the upload and starting over.                                                                                                                                                                                                                     | `client/src/pages/admin/CCTVIntelligence.tsx:708`                                                                    | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 130 | CCTV-21 | S3  | The keyframe timestamp label is absolutely positioned inside a button that is not a positioning context, so it renders against the wrong ancestor instead of over its thumbnail.                                                                                                                                                                                                             | `client/src/pages/admin/CCTVIntelligence.tsx:588-601`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 131 | CCTV-22 | S3  | Webcam failures are only written to the console. A denied camera permission renders a black rectangle with no message and no recovery action.                                                                                                                                                                                                                                                | `client/src/pages/admin/CCTVIntelligence.tsx:96-107`                                                                 | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 132 | CCTV-23 | S3  | The four-second scan loop keeps running when the browser tab is hidden, and because `runDetection` depends on `isProcessing` its identity changes on every scan, tearing down and recreating the interval each cycle.                                                                                                                                                                        | `client/src/pages/admin/CCTVIntelligence.tsx:169-172,205-234`                                                        | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 133 | CCTV-24 | S3  | `averageConfidence` and `maxConfidence` are computed, returned, and never displayed. The results panel shows two of the four available statistics, which is the direct cause of the analysis not reporting useful detail.                                                                                                                                                                    | `client/src/pages/admin/CCTVIntelligence.tsx:568-590`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 134 | CCTV-25 | S3  | There is no empty state. An analysis that finds nothing still renders a green tick, "Analysis Complete", and a 0 percent confidence bar, which reads as a broken feature rather than a negative result.                                                                                                                                                                                      | `client/src/pages/admin/CCTVIntelligence.tsx:559-566`                                                                | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 135 | CCTV-26 | S2  | The pipeline detects object categories but never re-identifies a specific item. A reported "match" means only that some object of that class appeared on camera, with no comparison against the lost item's own images, which is the actual product requirement.                                                                                                                             | `models/app.py:139-190`; `server/src/routes/cctv.ts:53-150`                                                          | 36    | `feat/reclaim-236-cctv-reid`           | [ ]    |
| 136 | CCTV-27 | S3  | No multi-object tracking, so one physical object visible across twenty frames produces twenty unrelated detections rather than one track with a best representative crop.                                                                                                                                                                                                                    | `models/app.py:139-190`                                                                                              | 36    | `feat/reclaim-236-cctv-reid`           | [ ]    |
| 137 | CCTV-28 | S3  | The settings fetch on this screen uses raw `fetch` rather than `authFetch`, so the CCTV page breaks as soon as Track A phase 3 protects the settings endpoint.                                                                                                                                                                                                                               | `client/src/pages/admin/CCTVIntelligence.tsx:71-79`                                                                  | 3     | `fix/reclaim-203-auth-hardening`       | [x]    |
| 138 | CCTV-29 | S3  | Inference is invoked with default parameters on every frame: default image size, default verbosity, no confidence argument, and no device selection. Per-frame model logging is written to stdout in production.                                                                                                                                                                             | `models/app.py:78,145`                                                                                               | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |
| 139 | CCTV-30 | S3  | `foundItemData` is typed `any`, and the screen is 836 lines combining camera control, upload, analysis, results rendering, and item registration in a single component.                                                                                                                                                                                                                      | `client/src/pages/admin/CCTVIntelligence.tsx:65,1-836`                                                               | 34    | `refactor/reclaim-234-cctv-rebuild`    | [ ]    |

Register totals across all three parts: 139 findings. S1: 23. S2: 56. S3: 50. S4: 10.

## 25. Track C phase plan

| Phase | Branch                                   | Delivers                                                                                                                                                                                                                        | Depends on                                  | Status |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| 34    | `refactor/reclaim-234-cctv-rebuild`      | Sections 21.6 and 21.7. Component split, overlay geometry, stale-box and stale-detection fixes, unit normalisation, honest statistics and empty states, exact class matching, configurable thresholds, truthful health endpoint | Track A phase 15                            | [ ]    |
| 35    | `feat/reclaim-235-cctv-video-pipeline`   | Section 21.5. Direct-to-storage upload, job-based analysis, server-side decoding and sampling with hard caps, batched inference, real progress events, persisted analysis records                                               | Track B phase 20, phase 34                  | [ ]    |
| 36    | `feat/reclaim-236-cctv-reid`             | Sections 21.2 and 21.4. Tracking, crop embedding, re-identification against item image embeddings, ranked sightings, optional open-vocabulary detection gated on evaluation, CCTV evaluation set in CI                          | Track B phase 22, phase 35                  | [ ]    |
| 37    | `chore/reclaim-237-production-toolchain` | Section 22. Dockerfiles and compose, infrastructure and rules as code, migration runner, full CI/CD pipeline, OpenTelemetry tracing and metrics, dashboards and alerts, load and resilience tests, runbooks                     | Track B phase 20                            | [ ]    |
| 38    | `docs/reclaim-238-interview-artifacts`   | Section 23. Measured before-and-after numbers filled in, demo script rehearsed, architecture overview and ADR set finalised, published API documentation                                                                        | 37, and every phase whose numbers it quotes | [ ]    |

## 26. Track C open decisions

| #   | Decision                | Options                                                                                                        | Recommendation                                                                                                                                                                                  | Blocks |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 14  | Live detection location | Server round trip, or in-browser inference with a server fallback                                              | In-browser via ONNX Runtime Web where supported. Removes the network hop and makes the overlay responsive instead of a four-second slideshow                                                    | 34     |
| 15  | Detector vocabulary     | Keep the fixed 80-class detector, fine-tune it on a lost-property taxonomy, or adopt open-vocabulary detection | Fix the current taxonomy mismatch first, then let the evaluation set decide between fine-tuning and open-vocabulary. Do not adopt the newer approach on reputation                              | 36     |
| 16  | Video storage           | Direct-to-storage upload with signed URLs, or keep routing bytes through the API                               | Direct to storage. The API should never receive video bytes                                                                                                                                     | 35     |
| 17  | Footage retention       | Delete after analysis, retain for a fixed window, or retain until the case closes                              | Retain only for the dispute window, then delete. CCTV footage of identifiable people carries the heaviest privacy obligations in this system, and there is currently no retention policy at all | 35     |
| 18  | Vision service scope    | Keep the Python service for detection only, or move embedding there too                                        | Detection only. Embeddings stay in the Node worker per decision 8, so there is one embedding implementation rather than two                                                                     | 36     |
