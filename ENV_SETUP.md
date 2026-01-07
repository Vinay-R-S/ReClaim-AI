# Environment Variables Configuration

## Required for Image Matching

Add the following to your `.env` file in the root directory:

```bash
# Clarifai API Configuration
CLARIFAI_API_KEY=your_clarifai_api_key_here
# OR use:
CLARIFAI_PAT=your_clarifai_personal_access_token_here

# Optional: Custom Clarifai settings (defaults shown)
# CLARIFAI_USER_ID=clarifai
# CLARIFAI_APP_ID=main
# CLARIFAI_MODEL_ID=general-image-recognition
```

## How to Get Clarifai API Key

1. Go to [https://clarifai.com](https://clarifai.com)
2. Sign up or log in
3. Navigate to Settings → Security
4. Create a new Personal Access Token (PAT)
5. Copy the token and add it to `.env` as `CLARIFAI_PAT=<your_token>`

## Testing

After adding the API key:
1. Restart the server: `npm run dev`
2. Upload a Lost item with an image
3. Upload a Found item with a similar image
4. Check server logs for `[AUTO-MATCH]` messages
5. Verify match appears in admin dashboard
