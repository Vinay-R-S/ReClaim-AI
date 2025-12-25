# FireBase Setup Instructions

### Step 1: Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter project name: reclaim-ai (or your preference)
4. Enable/disable Google Analytics (optional)
5. Click "Create project"

### Step 2: Enable Authentication
1. In Firebase Console, click "Build" → "Authentication"
2. Click "Get started"
3. Enable Email/Password provider:
4. Click "Email/Password" → Toggle "Enable" → Save
5. Enable Google provider:
6. Click "Google" → Toggle "Enable"
7. Add a project support email (your email)
8. Click "Save"

### Step 3: Create Web App
1. Go to Project Settings (gear icon)
2. Scroll to "Your apps" → Click web icon (</🔥>)
3. Register app with nickname: reclaim-ai-web
4. Copy the Firebase config object (you'll need this)

### Step 4: Enable Firestore (for user data)
1. Build → Firestore Database → Create database
2. Start in test mode (we'll add rules later)
3. Select a region close to you

<hr>

# Firebase Setup Codes
```bash
npm install firebase
```

```js
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDgbBYNAJhSiIzPrenievyjlqoQ3M6HDN4",
  authDomain: "reclaim-ai-bc273.firebaseapp.com",
  projectId: "reclaim-ai-bc273",
  storageBucket: "reclaim-ai-bc273.firebasestorage.app",
  messagingSenderId: "15651340362",
  appId: "1:15651340362:web:f3225c54b27cb8258526b3",
  measurementId: "G-YL3R3JRTYS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
```

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if
          request.time < timestamp.date(2026, 1, 24);
    }
  }
}
```
