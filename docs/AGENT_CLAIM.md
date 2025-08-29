
# Agent Claim API

This document describes how to use the `agentClaim` Firebase Function. This function is a public endpoint that allows a local agent to exchange a short-lived, user-provided claim token for a permanent, secret API key.

## Endpoint

**Method**: `POST`
**URL**: `https://<REGION>-<PROJECT_ID>.cloudfunctions.net/agentClaim`

## Request Body (JSON)

| Field | Type | Required | Description |
|---|---|---|---|
| `claimPublicId` | `string` | Yes | The public part of the claim token (`pub-...`). |
| `claimSecret` | `string` | Yes | The secret part of the claim token (`sec-...`). |
| `agentName` | `string` | No | A user-friendly name for this agent (e.g., "Main Synology"). |
| `agentVersion` | `string` | No | The version of the agent software (e.g., "1.0.0"). |

## Success Response (200 OK)

A successful claim returns the permanent API key. The agent **MUST** store this key securely and use it for all future authenticated requests. This is the only time the key is ever revealed in plaintext.

```json
{
  "agentApiKey": "a_long_random_32_byte_hex_string_...",
  "serverId": "the_uuid_of_the_server_doc_in_firestore"
}
```

## Error Responses

| Status Code | Error Status | Reason |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | `claimPublicId` or `claimSecret` was missing from the request body. |
| 403 | `PERMISSION_DENIED` | The `claimPublicId` doesn't exist, or the `claimSecret` was incorrect. This is a generic error to prevent leaking information about which part was wrong. |
| 405 | `METHOD_NOT_ALLOWED` | The request used a method other than `POST`. |
| 409 | `ALREADY_EXISTS` | The claim token has already been used. A token can only be claimed once. |
| 410 | `FAILED_PRECONDITION` | The claim token has expired (default TTL is 10 minutes). The user needs to generate a new one. |
| 500 | `INTERNAL` | An unexpected server-side error occurred. |

## Testing with cURL

Replace placeholders with actual values from the `claimToken` function response.

### Test 1: Success (200 OK)

```sh
AGENT_CLAIM_URL="https://<REGION>-<PROJECT_ID>.cloudfunctions.net/agentClaim"
PUBLIC_ID="<paste_pub_id_here>"
SECRET="<paste_sec_id_here>"

curl -i -X POST "$AGENT_CLAIM_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "claimPublicId": "'"$PUBLIC_ID"'",
    "claimSecret": "'"$SECRET"'",
    "agentName": "My Test Agent",
    "agentVersion": "0.1.0"
  }'
```

### Test 2: Invalid Signature (403 Forbidden)

```sh
curl -i -X POST "$AGENT_CLAIM_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "claimPublicId": "'"$PUBLIC_ID"'",
    "claimSecret": "this-is-the-wrong-secret"
  }'
```

### Test 3: Already Claimed (409 Conflict)

Run the successful `curl` command a second time.

### Test 4: Expired Token (410 Gone)

Wait for more than 10 minutes after generating the token before attempting to claim it.
