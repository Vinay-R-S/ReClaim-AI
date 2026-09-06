# Client source structure

What lives where in `client/src`. Data fetching belongs in `services/` and
`hooks/`, never in JSX; every write goes through the API rather than straight
to Firestore.

## Top level

- `main.tsx` mounts `App` in `StrictMode`.
- `App.tsx` the router: public routes, the user area behind `ProtectedRoute`,
  the admin area behind `AdminRoute`, all lazily loaded.
- `index.css` Tailwind and the design tokens. `App.css` the little that is not
  a token.

## `pages/`

- `LandingPage`, `AuthPage`, `WelcomePage`, `NotFoundPage`,
  `UnderConstruction`.
- `VerifyHandoverPage` is public by design: the finder holds a link and a code,
  not an account. It is the one screen with its own test file.
- `admin/` `AdminPage` (shell), `MainDashboard`, `AdminDashboard`,
  `MatchesPage`, `PendingApprovalsPage`, `HandoversPage`, `UsersManagement`,
  `CCTVIntelligence`, `AdminSettings`, `AdminProfile`.
- `user/` `HomePage`, `MyReportsPage`, `HandoversPage`, `ProfilePage`,
  `HowItWorksPage`.

## `services/`

One module per domain, each built on `lib/api.ts`: `itemService`,
`matchService`, `handoverService`, `userService`, `aiService`, `cctvService`.

## `hooks/`

Where the fetching and the state live: `useItems`, `useMatches`, `useMatchPoll`,
`useHandovers`, `useCredits`, `useDashboardStats`, `useSettings`,
`useItemImages`, `useUserFilters`, and `useFeedback`, which owns the one
transient message per screen that replaced `window.alert`.

## `context/`

`AuthContext.tsx` holds the session, the role and the sign-in and sign-out
calls. Role gating reads from here.

## `components/`

- `ui/` the shared primitives: `Feedback`, `ImageCarousel`, `LocationPicker`
  and its lazy wrapper, the date and location modals.
- `layout/` `AdminLayout` and `UserLayout`.
- `auth/` `ProtectedRoute` and `AdminRoute`, the two route guards.
- `admin/` the admin surfaces: `MatchReviewModal` (the verify or reject
  decision), `HandoverSessions` (open, blocked and expired handovers, and the
  only way to re-issue a code), `ItemDetailModal`, `ItemReviewHistory`,
  `RejectItemDialog`, `AddItemModal`, `UserDetailModal`, `CameraContextPanel`,
  `ItemHeatmap`, plus `dashboard/` and `users/`.
- `user/` `ReportItemModal` and `EditReportModal`.
- `item/` the pieces both report modals are built from: `ImagePicker`,
  `ItemDetailsFields`, `LocationDateFields`, `ReportSuccessPanel`.

## `lib/`

- `api.ts` the single API layer: `ApiError`, the token-carrying helpers
  (`authGet`, `authPost`, `authPut`, `authDelete`) and the public ones
  (`apiGet`, `apiPost`). Nothing calls `fetch` directly.
- `firebase.ts` the web SDK, used for auth and for the few remaining reads.
- `timestamps.ts` reads the several shapes a date arrives in.
- `imageCompression.ts`, `icons.ts`, `utils.ts`.

## `types/`

`domain.ts` re-exports the shared document shapes from `shared/domain.d.ts`
with the Web SDK timestamp bound. Domain types are imported, never redeclared.

## Tests

Vitest with jsdom and Testing Library, next to the code they cover. `npm test`
runs them.
