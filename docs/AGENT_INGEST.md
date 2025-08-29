
# Agent Ingest API

This document describes how to use the `agentIngest` Firebase Function. This function is a public endpoint that allows a linked local agent to securely upload media metadata to a user's library.

## Endpoint

**Method**: `POST`
**URL**: `https://<REGION>-<PROJECT_ID>.cloudfunctions.net/agentIngest`

## Authentication

Authentication is performed via a Bearer token in the `Authorization` header. The token is the permanent, plaintext `agentApiKey` received from the `agentClaim` endpoint.

**Header Example**: `Authorization: Bearer <your_agent_api_key>`

## Request Body (JSON)

The request body must be a JSON object with a single key, `items`, which is an array of media objects.

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | `Array<MediaItem>` | Yes | An array of media items to upsert. Max 200 items per request. |

The entire raw request body must not exceed 5 MB.

### MediaItem Object

| Field | Type | Required | Description |
|---|---|---|---|
| `mediaId` | `string` | No | A unique ID for the media. If omitted, it will be deterministically generated from `serverId` and `path`. |
| `title` | `string` | Yes | The title of the media. |
| `filename` | `string` | Yes | The original filename on disk. |
| `path` | `string` | Yes | The full, unique path to the file on the agent's filesystem. |
| `type` | `string` | Yes | Must be either `'movie'` or `'episode'`. |
| `season` | `number` | No | The season number for TV episodes. |
| `episode` | `number` | No | The episode number for TV episodes. |
| `year` | `number` | No | The release year of the media. |
| `size` | `number` | Yes | The file size in bytes. Must be > 0. |
| `duration` | `number` | Yes | The duration of the media in seconds. Must be > 0. |
| `codec` | `string` | No | The video/audio codec information. |
| `posterUrl` | `string` | No | A valid URL to the poster image. |
| `backdropUrl`| `string` | No | A valid URL to the backdrop image. |
| `tmdbId` | `number` | No | The Movie Database ID for metadata enrichment. |
| `addedAt` | `string` | No | An ISO 8601 timestamp for when the media was added. |

## Responses

### 200 OK (All Succeeded)
All items in the payload were successfully validated and upserted.

```json
{
  "results": [
    { "mediaId": "f3c8...", "status": "upserted", "path": "/path/to/movie.mkv" },
    { "mediaId": "a1b2...", "status": "upserted", "path": "/path/to/another.mkv" }
  ]
}
```

### 207 Multi-Status (Partial Success)
Some items were upserted, while others failed validation.

```json
{
  "results": [
    { "mediaId": "f3c8...", "status": "upserted", "path": "/path/to/good.mkv" },
    { "status": "error", "message": "Invalid payload: size must be positive", "path": "/path/to/bad.mkv" }
  ]
}
```

### 400 Bad Request (All Failed or Invalid Payload)
The entire payload was invalid, or every item within it failed validation.

```json
{
  "results": [
    { "status": "error", "message": "Invalid payload: title is required", "path": "/path/to/invalid.mkv" }
  ]
}
```

### Other Error Responses

| Status Code | Error Status | Reason |
|---|---|---|
| 401 | `UNAUTHENTICATED` | The `Authorization` header was missing or did not contain a `Bearer` token. |
| 403 | `PERMISSION_DENIED` | The provided `agentApiKey` was invalid or unauthorized. |
| 405 | `METHOD_NOT_ALLOWED` | The request used a method other than `POST`. |
| 413 | `PAYLOAD_TOO_LARGE`| The request body exceeded the 5 MB size limit. |
| 500 | `INTERNAL` | An unexpected server-side error occurred. |

## Testing with cURL

Replace placeholders with actual values.

### Test 1: Success (200 OK)

```sh
INGEST_URL="https://<REGION>-<PROJECT_ID>.cloudfunctions.net/agentIngest"
API_KEY="<paste_your_agent_api_key>"

curl -i -X POST "$INGEST_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "title": "The Matrix",
        "filename": "The.Matrix.1999.mkv",
        "path": "/media/movies/The.Matrix.1999.mkv",
        "type": "movie",
        "year": 1999,
        "size": 2147483648,
        "duration": 8160
      }
    ]
  }'
```

### Test 2: Invalid API Key (403 Forbidden)

```sh
curl -i -X POST "$INGEST_URL" \
  -H "Authorization: Bearer an-obviously-wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"items":[]}'
```
