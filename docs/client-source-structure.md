# Client Source Files Documentation

This document explains the structure and purpose of the files in `client/src`.

## Top-Level Files

- **`main.tsx`**: The entry point of the React application. It finds the root element in the HTML and renders the `App` component within `StrictMode`.
- **`App.tsx`**: The main application component facing routing. It sets up the `BrowserRouter`, defines routes for public, user, and admin sections, and handles lazy loading of page components.
- **`App.css`**: Global styles applied to the App component.
- **`index.css`**: Global CSS styles, likely including Tailwind directives and base styles.

## Directories

### `pages/`

Contains the main view components (screens) of the application.

- **`LandingPage.tsx`**: The public homepage of the application.
- **`AuthPage.tsx`**: Handles user authentication (login and signup).
- **`WelcomePage.tsx`**: A welcome screen for new or returning users.
- **`VerifyHandoverPage.tsx`**: A page for users to verify handover requests (likely via a link).
- **`UnderConstruction.tsx`**: A placeholder page for incomplete features.
- **`admin/`**:
  - **`AdminDashboard.tsx`**: Overview dashboard for administrators.
  - **`AdminProfile.tsx`**: Admin profile settings.
  - **`AdminSettings.tsx`**: System-wide settings configuration.
  - **`UsersManagement.tsx`**: Interface for managing platform users.
  - **`CCTVIntelligence.tsx`**: Interface for viewing or managing CCTV-based item detection.
  - **`HandoversPage.tsx`**: Admin view of all item handovers.
  - **`MatchesPage.tsx`**: Admin view of item matches.
  - **`PendingApprovalsPage.tsx`**: Management of items or actions requiring admin approval.
  - **`MainDashboard.tsx`**: Likely the central hub for admin stats and actions.
- **`user/`**:
  - **`HomePage.tsx`**: The main dashboard for logged-in users.
  - **`ProfilePage.tsx`**: User profile management.
  - **`MyReportsPage.tsx`**: List of items reported lost or found by the user.
  - **`HowItWorksPage.tsx`**: Explainer page for the user flow.
  - **`HandoversPage.tsx`**: Status of users' own handovers.

### `services/`

Contains modules for making API calls to the backend.

- **`aiService.ts`**: Handles interactions with AI endpoints (e.g., image analysis).
- **`authService.ts` / `userService.ts`**: Authentication and user profile operations.
- **`itemService.ts`**: CRUD operations for lost/found items.
- **`matchService.ts`**: Operations related to finding matches between items.
- **`handoverService.ts`**: Managing the exchange process of items.
- **`cctvService.ts`**: API calls related to CCTV video analysis features.

### `context/`

- **`AuthContext.tsx`**: Provides extensive global state for authentication (user session, login/logout functions) using React Context API.

### `components/`

Reusable UI components.

- **`ui/`**: Basic building blocks (buttons, inputs, cards, etc.), potentially from a library like Shadcn UI.
- **`layout/`**: Structural components like Headers, Footers, Sidebars.
- **`auth/`**: Auth-specific components like `ProtectedRoute` (guards routes) and `AdminRoute`.
- **`admin/` & `user/`**: Components specific to admin or user dashboards.

### `lib/`

Utility libraries and configuration.

- **`authApi.ts`**: Low-level Axios setup or fetch wrappers for auth.
- **`firebase.ts`**: Firebase SDK configuration (if used heavily on client).
- **`icons.ts`**: Centralized icon exports.
- **`utils.ts`**: General helper functions (class name merging, formatting).
