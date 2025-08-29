# TMDB Enrichment API

This document describes the two Firebase Functions for enriching media metadata using The Movie Database (TMDB).

- `tmdbEnrich`: An on-demand HTTPS endpoint for a client to request immediate enrichment for a batch of items.
- `tmdbBackfill`: A scheduled function that runs periodically to find and enrich media items that are missing metadata.

## Environment Configuration

Both functions require a TMDB API key. This key must be configured in your environment.

### Local Development (Emulator)

For local testing with the Firebase Emulator Suite, add the following to your `.env` file at the project root:

```
TMDB_API_KEY="your_tmdb_api_v3_key"
```

### Production Deployment

For your deployed function, you must set the secret in the Google Cloud console for both `tmdbEnrich` and `tmdbBackfill`.

1.  Go to the [Google Cloud Functions console](https://console.cloud.google.com/functions).
2.  Select your project and find the function.
3.  Edit the function and navigate to the "Runtime, build and connections settings" section.
4.  Under "Runtime environment variables", add a variable named `TMDB_API_KEY` with your production key.

## Deployment

Deploy the functions using the standard deployment script:

```sh
npm run deploy:functions
```

This will deploy all functions, including the new `tmdbEnrich` and `tmdbBackfill` functions.

---

## On-Demand Enrichment API (`tmdbEnrich`)

This is a protected HTTPS endpoint that requires a user to be authenticated.

**Method**: `POST`
**URL**: `https://<REGION>-<PROJECT_ID>.cloudfunctions.net/tmdbEnrich`

**Authentication**: Requires a Firebase ID token in the `Authorization` header (`Bearer <ID_TOKEN>`).

### Request Body (JSON)

The body must contain an `items` array, with each object specifying the media to be enriched.

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | `Array<EnrichItem>` | Yes | An array of media items to enrich. Max 50 items per call. |

**EnrichItem Object**

| Field | Type | Required | Description |
|---|---|---|---|
| `mediaId` | `string` | Yes | The Firestore document ID of the media to update. |
| `type` | `string` | Yes | Must be `'movie'` or `'episode'`. |
| `title` | `string` | Yes | The title to search for on TMDB. |
| `year` | `number` | No | The release year, used to improve search accuracy. |

### Responses

- **200 OK**: The request was processed. The body contains a `results` array with the status for each item.
  - `status: "enriched"`: Successfully found and updated metadata.
  - `status: "skipped"`: Item already had sufficient metadata.
  - `status: "not_found"`: Could not find a match on TMDB.
  - `status: "error"`: An unexpected error occurred for this item.
- **400 Bad Request**: The request body was malformed (e.g., missing `items` array).
- **401 Unauthorized**: The `Authorization` header was missing or the ID token was invalid.
- **412 Precondition Failed**: The `TMDB_API_KEY` is not configured on the server.
- **429 Too Many Requests**: The user has made too many requests in a short period (rate-limited).
- **500 Internal Server Error**: An unexpected server-side error occurred.

### `curl` Test Examples

**Success (200 OK)**
```sh
ENRICH_URL="https://<REGION>-<PROJECT_ID>.cloudfunctions.net/tmdbEnrich"
ID_TOKEN="<valid_firebase_id_token>"

curl -i -X POST "$ENRICH_URL" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"mediaId":"the-matrix-1999","type":"movie","title":"The Matrix","year":1999}]}'
```

**Rate-Limited (429)**
```sh
# Call twice in quick succession with the same ID_TOKEN
curl ... # (first call)
curl ... # (second call) -> should return 429
```

---

## Scheduled Backfill (`tmdbBackfill`)

This function has no public endpoint. It is triggered automatically by Cloud Scheduler every 60 minutes.

**Functionality**:
1.  Queries for up to 200 media documents across all users that are missing a `tmdbId`.
2.  Groups these documents by their owner's UID.
3.  For each owner, it calls the internal `tmdbEnrichFlow` to process their items.
4.  A small delay is added between processing each user to avoid hitting external API rate limits.
5.  Logs its progress to the Cloud Functions logs.
