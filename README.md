# ReClaim-AI

ReClaim AI is an AI-powered Lost & Found web application that matches lost and found items using image recognition, natural language understanding, and intelligent search powered by modern AI and Google technologies - GDG Hackathon.

## Tech Stack

- **Frontend Framework**: [React](https://reactjs.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [TailwindCSS](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Routing**: [React Router DOM](https://reactrouter.com/)

## Key Features

- **AI-Powered Matching**: Uses Google Gemini to match lost and found items.
- **Secure Authentication**: Google OAuth and Email/Password login.
- **Admin Dashboard**: Secure admin access for managing reports (Whitelisted emails only).
- **Responsive Design**: Modern, glassmorphic UI with dark/light mode support (Google-themed).

## Prerequisites

Ensure you have the following installed on your machine:

- [Node.js](https://nodejs.org/) (Version 18 or higher recommended)
- npm (Node Package Manager)

## Getting Started

Follow these steps to set up the project locally.

### 1. Clone the Repository

```bash
git clone https://github.com/Vinay-R-S/ReClaim-AI.git
cd ReClaim-AI
```

### 2. Install Dependencies

Install the project dependencies using npm:

```bash
npm ci
```

### 3. Firebase Configuration

This project uses Firebase for Authentication and Database.

1.  Create a project at [Firebase Console](https://console.firebase.google.com/).
2.  Navigate to **Project Settings** > **General** and add a Web App to get your configuration keys.
3.  Enable **Authentication**:
    - Go to **Build** > **Authentication** > **Sign-in method**.
    - Enable **Email/Password** and **Google** providers.
4.  Enable **Firestore Database**:
    - Go to **Build** > **Firestore Database** > **Create Database**.
    - Start in **Test mode** (or Production mode and set up security rules).
5.  Set up Environment Variables:
    - Copy `.env.example` to a new file named `.env`:
      ```bash
      cp .env.example .env
      ```
    - Fill in the Firebase configuration values in `.env`.
    - Set the **Admin Email** in `.env` to grant admin privileges:
      ```properties
      VITE_ADMIN_EMAIL="your-admin-email@gmail.com"
      ```

## Available Scripts

In the project directory, you can run the following scripts:

### Development

Runs the app in the development mode.

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view it in your browser. The page will reload when you make changes.

### Build

Builds the app for production to the `dist` folder.

```bash
npm run build
```

It correctly bundles React in production mode and optimizes the build for the best performance.

### Preview

Locally preview the production build.

```bash
npm run preview
```

### Lint

Runs ESLint to check for code quality issues.

```bash
npm run lint
```
