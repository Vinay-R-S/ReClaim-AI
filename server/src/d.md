# Server Source Files Documentation

This document explains the structure and purpose of the files in `server/src`.

## Top-Level Files

- **`index.ts`**: The entry point of the server. It loads environment variables (using `dotenv`) and then dynamically imports `app.ts` to start the server. This ensures env vars are ready before app initialization.
- **`app.ts`**: The main Express application file. It configures middleware (CORS, Helmet, compression, Body parsers), registers all API routes (`/api/auth`, `/api/items`, etc.), and sets up global error handling and the server listener.

## Directories

### `routes/`

Defines the API endpoints and maps them to controllers or logic.

- **`auth.ts`**: Endpoints for user authentication (register, login, verify).
- **`items.ts`**: Endpoints for creating, retrieving, and updating lost/found items.
- **`matches.ts`**: Endpoints for matching logic and retrieving potential matches.
- **`handover.ts` / `handovers.ts`**: Endpoints for managing the item handover workflow.
- **`verification.ts`**: Endpoints for verifying ownership or users.
- **`settings.ts`**: Endpoints for application settings.
- **`notifications.ts`**: Endpoints for user notifications.
- **`credits.ts`**: Endpoints for managing user credits or rewards.
- **`cctv.ts`**: Endpoints for CCTV integration features.

### `services/`

Contains the core business logic, separating it from the HTTP layer.

- **`autoMatch.service.ts`**: Background service or logic for automatically finding matches between items.
- **`clarifaiMatch.service.ts`**: Specific service using Clarifai for image recognition/matching.
- **`matching.ts`**: Core matching algorithms.
- **`handover.service.ts`**: Logic handling the state machine of item handovers.
- **`verificationAgent.ts`**: AI or logic to assist in verifying claims.
- **`email.ts`**: Service for sending transactional emails.
- **`blockchain.service.ts`**: Integration for blockchain features (possibly for immutable records of items/handovers).
- **`cloudinary.ts`**: Service for uploading and managing images.
- **`userStats.ts`**: Logic for calculating and retrieving user statistics.

### `middleware/`

Express middleware functions that run before route handlers.

- **`auth.middleware.ts`**: Verifies JWT tokens or sessions to protect routes.
- **`role.middleware.ts`**: Checks if an authenticated user has the required permissions (e.g., Admin).
- **`rateLimit.middleware.ts`**: Limits the number of requests a user/IP can make.
- **`validation.middleware.ts`**: Validates incoming request bodies (likely using Zod or Joi).
- **`errorHandler.middleware.ts`**: Standardized error response formatting.

### `utils/`

Helper functions and shared configurations.

- **`firebase-admin.ts`**: Configuration for Firebase Admin SDK (server-side Firebase access).
- **`llm.ts`**: Utilities for interacting with Large Language Models.
- **`embeddings.ts`**: Utilities for generating or managing vector embeddings (for semantic search/matching).
- **`scoring.ts`**: Algorithms for scoring the quality of matches.
- **`safety.ts`**: Content safety checks or sanitization.

### `contracts/`

Contains blockchain smart contracts.

- **`ReclaimHandover.sol`**: Solidity smart contract managing the secure handover process on the blockchain.
- **`Deploy.md`**: Instructions or notes regarding contract deployment.
