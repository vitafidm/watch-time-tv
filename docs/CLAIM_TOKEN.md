
# Claim Token API

This document describes how to deploy and test the `claimToken` Firebase Function. This function is responsible for generating a one-time token that a local agent can use to securely link itself to a user's account.

## Environment Configuration

The function uses an HMAC secret to sign claim tokens. This secret must be configured in your environment.

### Local Development (Emulator)

For local testing with the Firebase Emulator Suite, create a `.env` file in the project root and add the following line. Use a strong, randomly generated secret.

```
HMAC_SECRET="your-super-long-and-random-secret-for-local-dev"
```

The emulator will automatically load this variable.

### Production Deployment

For your deployed function, you must set the secret in the Google Cloud console:

1.  Go to the [Google Cloud Functions console](https://console.cloud.google.com/functions).
2.  Select your project and find the `claimToken` and `agentClaim` functions.
3.  Edit each function and navigate to the "Runtime, build and connections settings" section.
4.  Under "Runtime environment variables", add a variable named `HMAC_SECRET` with your production secret.

## Deployment

Deploy the function using the provided npm script:

```sh
npm run deploy:functions
```

This will deploy all functions defined in `src/functions/index.ts`.

## Testing with cURL

You can test the deployed function using `curl`. You will need a valid Firebase ID token for an authenticated user.

First, get your function's URL from the Firebase console or `firebase functions:list`.

### Test 1: Success (200 OK)

This test simulates a successful request from an authenticated user.

```sh
FUNCTION_URL="https://<REGION>-<PROJECT_ID>.cloudfunctions.net/claimToken"
ID_TOKEN="<PASTE_VALID_FIREBASE_ID_TOKEN_HERE>"

curl -s -X POST "$FUNCTION_URL" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:** A JSON object with the claim details.
```json
{
  "serverId": "...",
  "claimPublicId": "...",
  "claimSecret": "...",
  "expiresAtISO": "..."
}
```

### Test 2: Unauthenticated (401 Unauthorized)

This tests that unauthenticated requests are rejected.

```sh
FUNCTION_URL="https://<REGION>-<PROJECT_ID>.cloudfunctions.net/claimToken"

curl -s -X POST "$FUNCTION_URL" -H "Content-Type: application/json"
```

**Expected Response:** An error indicating missing authentication.
```json
{
  "error": {
    "status": "UNAUTHENTICATED",
    "message": "Missing or invalid Authorization header. Use `Bearer <ID_TOKEN>`."
  }
}
```

### Test 3: Rate-Limited (429 Too Many Requests)

This tests the per-user rate limit by making two requests in quick succession with the same ID token.

```sh
FUNCTION_URL="https://<REGION>-<PROJECT_ID>.cloudfunctions.net/claimToken"
ID_TOKEN="<PASTE_VALID_FIREBASE_ID_TOKEN_HERE>"

# First request should succeed
curl -s -X POST "$FUNCTION_URL" -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json"

# Second request immediately after should be rate-limited
curl -s -X POST "$FUNCTION_URL" -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json"
```

**Expected Response (for the second call):** An error indicating the rate limit was hit.
```json
{
  "error": {
    "status": "RESOURCE_EXHAUSTED",
    "message": "A pending claim token was created recently. Please try again shortly."
  }
}
```
