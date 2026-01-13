# ReClaim AI - Lost & Found Management System

An AI-powered lost and found management platform that uses computer vision and natural language processing to help reunite people with their lost items.

## Features

- **AI-Powered Item Recognition** - Upload images and let AI identify and describe items
- **Smart Matching** - Automatic matching between lost and found items
- **Real-time Chat** - Conversational interface to report lost/found items
- **Admin Dashboard** - Manage all reported items, users, and matches
- **Credits System** - Reward users for reporting found items
- **Location Picker** - Search and select locations with interactive map

## Project Structure

```
ReClaim-AI/
├── client/          # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── context/
│   └── package.json
├── server/          # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── agents/
│   │   └── utils/
│   └── package.json
├── .env.example     # Environment variables template
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Firebase project
- Cloudinary account (for image storage)
- Groq/Gemini API key (for AI)

### 1. Clone & Install

```bash
git clone https://github.com/Vinay-R-S/ReClaim-AI.git
cd ReClaim-AI

# Install client dependencies
cd client
npm install

# Install server dependencies
cd ../server
npm install
```

### 2. Configure Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env` with your credentials (see [Environment Variables](#-environment-variables) section below).

### 3. Run Development Servers

**Terminal 1 - Backend:**

```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**

```bash
cd client
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

---

## Environment Variables

### Client Variables (prefix: `VITE_`)

| Variable                            | Description               | How to Get                                                                           |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `VITE_FIREBASE_API_KEY`             | Firebase Web API Key      | [Firebase Console](https://console.firebase.google.com) → Project Settings → General |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Firebase Auth Domain      | Same as above, format: `{project-id}.firebaseapp.com`                                |
| `VITE_FIREBASE_PROJECT_ID`          | Firebase Project ID       | Same as above                                                                        |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Firebase Storage Bucket   | Same as above, format: `{project-id}.appspot.com`                                    |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging Sender ID       | Same as above                                                                        |
| `VITE_FIREBASE_APP_ID`              | Firebase App ID           | Same as above                                                                        |
| `VITE_ADMIN_EMAIL`                  | Admin user's email        | Your admin email address                                                             |
| `VITE_GROQ_API_KEY`                 | Groq API Key (optional)   | [Groq Console](https://console.groq.com)                                             |
| `VITE_GEMINI_API_KEY`               | Gemini API Key (optional) | [Google AI Studio](https://aistudio.google.com/apikey)                               |
| `VITE_GEOAPIFY_API_KEY`             | Geoapify API Key          | [Geoapify](https://myprojects.geoapify.com/)                                         |
| `VITE_API_URL`                      | Backend API URL           | Default: `http://localhost:3001`                                                     |

### Server Variables

| Variable                       | Description                         | How to Get                                                        |
| ------------------------------ | ----------------------------------- | ----------------------------------------------------------------- |
| `GROQ_API_KEY`                 | Groq API Key for LLM                | [Groq Console](https://console.groq.com)                          |
| `GEMINI_API_KEY`               | Gemini API Key for LLM              | [Google AI Studio](https://aistudio.google.com/apikey)            |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Base64 encoded service account JSON | See [Firebase Admin Setup](#firebase-admin-sdk-setup)             |
| `FIREBASE_PROJECT_ID`          | Firebase Project ID                 | Firebase Console                                                  |
| `CLOUDINARY_CLOUD_NAME`        | Cloudinary Cloud Name               | [Cloudinary Console](https://console.cloudinary.com/) → Dashboard |
| `CLOUDINARY_API_KEY`           | Cloudinary API Key                  | Same as above                                                     |
| `CLOUDINARY_API_SECRET`        | Cloudinary API Secret               | Same as above                                                     |
| `RESEND_API_KEY`               | Resend API Key for emails           | [Resend Dashboard](https://resend.com/)                           |
| `FROM_EMAIL`                   | Sender email address                | Your verified domain email                                        |
| `CLIENT_URL`                   | Frontend URL                        | Default: `http://localhost:5173`                                  |
| `PORT`                         | Server port                         | Default: `3001`                                                   |

---

## Detailed Setup Guides

### Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Enable **Authentication** → Sign-in method → Google
4. Enable **Firestore Database** → Create in production mode
5. Enable **Storage** (optional, we use Cloudinary)
6. Go to **Project Settings** → General → Your apps → Add web app
7. Copy the config values to your `.env` file

### Firebase Admin SDK Setup

1. Go to **Project Settings** → **Service Accounts**
2. Click **Generate New Private Key**
3. Download the JSON file
4. Encode it to Base64:

   ```bash
   # On macOS/Linux
   base64 -i path/to/serviceAccountKey.json

   # On Windows PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\serviceAccountKey.json"))
   ```

5. Copy the entire Base64 string to `FIREBASE_SERVICE_ACCOUNT_KEY`

### Cloudinary Setup

1. Go to [Cloudinary Console](https://console.cloudinary.com/)
2. Sign up for a free account
3. From Dashboard, copy:
   - Cloud Name → `CLOUDINARY_CLOUD_NAME`
   - API Key → `CLOUDINARY_API_KEY`
   - API Secret → `CLOUDINARY_API_SECRET`

### Clarifai Setup (Required for Image Matching)

1. Go to [https://clarifai.com](https://clarifai.com)
2. Sign up or log in
3. Navigate to Settings → Security
4. Create a new Personal Access Token (PAT)
5. Copy the token and add it to `.env`:

   ```bash
   # Clarifai API Configuration
   CLARIFAI_PAT=your_clarifai_personal_access_token_here

   # Optional: Custom Clarifai settings (defaults shown)
   # CLARIFAI_USER_ID=clarifai
   # CLARIFAI_APP_ID=main
   # CLARIFAI_MODEL_ID=general-image-recognition
   ```

   _Note: Image matching functionality relies on this service._

### Groq API Setup

1. Go to [Groq Console](https://console.groq.com/)
2. Sign up (free tier available)
3. Create an API key
4. Copy to `GROQ_API_KEY` and `VITE_GROQ_API_KEY`

### Gemini API Setup

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key
3. Copy to `GEMINI_API_KEY` and `VITE_GEMINI_API_KEY`

### Geoapify Setup (for Location Picker)

1. Go to [Geoapify](https://myprojects.geoapify.com/)
2. Create a free account and project
3. Get your API key
4. Copy to `VITE_GEOAPIFY_API_KEY`

---

## Firestore Indexes

If you see Firestore index errors, create these composite indexes:

1. **creditTransactions** collection:

   - `userId` (Ascending) + `createdAt` (Descending)

2. **items** collection:
   - `reportedBy` (Ascending) + `createdAt` (Descending)

---

## Tech Stack

### Frontend

- React 18 + TypeScript
- Vite
- TailwindCSS
- Firebase (Auth, Firestore)
- Leaflet (Maps)
- Lucide Icons

### Backend

- Node.js + Express
- TypeScript
- Firebase Admin SDK
- Cloudinary (Image storage)
- Groq/Gemini (AI/LLM)
- Resend (Email)

---

## Demo

### Home Page

<img width="1782" height="852" alt="image" src="https://github.com/user-attachments/assets/67edbff7-db66-4b5b-9799-bb55cbb66bfd" />

### Why ReClaim AI

<img width="1900" height="860" alt="image" src="https://github.com/user-attachments/assets/9502261d-c818-4c69-8d25-5e9c9f385939" />

### Admin Dashboard

<img width="1916" height="860" alt="image" src="https://github.com/user-attachments/assets/77c6d31d-7bac-4ea4-b59b-2ea65ad4c2ca" />

### Users Management

<img width="1919" height="866" alt="image" src="https://github.com/user-attachments/assets/36a6a28a-3631-4aaf-8d79-357f719c88ba" />

### Admin Settings

<img width="1916" height="856" alt="image" src="https://github.com/user-attachments/assets/25cc0715-d41a-46f3-adfb-20f90cc09298" />

### Users Home Page

<img width="1807" height="771" alt="image" src="https://github.com/user-attachments/assets/819fe0ef-684f-469a-93a1-4c2ee835679b" />

### User Profile Page

<img width="1562" height="808" alt="image" src="https://github.com/user-attachments/assets/fb936e43-6b26-4e94-a4af-119c839d71ac" />

### Report Lost Item

<img width="1492" height="850" alt="image" src="https://github.com/user-attachments/assets/a9dbbbc9-ae14-4242-ab7b-a10b18925e0f" />

### Report Found Item

<img width="1466" height="854" alt="image" src="https://github.com/user-attachments/assets/da7acb50-cc0d-4e5c-95fa-d97425cb4fa9" />

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License.

---

## Acknowledgments

- GDG Open Innovation Hackathon 2025-26
- Uses Groq's fast inference for AI features
- Maps powered by Geoapify & Leaflet
