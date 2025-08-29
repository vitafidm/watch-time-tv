# Firestore Schema - Private Cinema

This document outlines the Firestore data model for the Private Cinema application. All data is strictly isolated on a per-user basis, rooted under the `/users/{uid}` path.

## Core Invariants

1.  **User-Scoped Data**: All collections and documents exist exclusively under `/users/{uid}`. There are no global collections.
2.  **Owner-Only Access**: Firestore rules enforce that only the authenticated user (`request.auth.uid == uid`) can read or write their own data.
3.  **Server Timestamps**: All `createdAt`, `updatedAt`, `linkedAt`, `lastSeen`, and `lastPlayedAt` fields MUST use `serverTimestamp()` to ensure chronological consistency regardless of client-side clock skew.

---

## Collections

### 1. User Root

- **Path**: `/users/{uid}`
- **Description**: Stores the root profile information for a user.

| Field       | Type      | Description                            |
|-------------|-----------|----------------------------------------|
| `uid`       | `string`  | The user's unique Firebase Auth UID.   |
| `email`     | `string`  | The user's email address.              |
| `createdAt` | `Timestamp` | Timestamp when the user doc was created. |

### 2. Servers

- **Path**: `/users/{uid}/servers/{serverId}`
- **Description**: Represents a user's local media servers (agents) that scan and provide media.

| Field             | Type      | Description                                                    |
|-------------------|-----------|----------------------------------------------------------------|
| `serverId`        | `string`  | A unique identifier for the server (e.g., a UUID).             |
| `name`            | `string`  | A user-friendly name for the server.                           |
| `status`          | `string`  | `'pending'` \| `'linked'`                                        |
| `claimPublicId`   | `string`  | A temporary public ID used for the claiming process.           |
| `claimSignature`  | `string`  | A signature to verify the claim request.                       |
| `apiKeyHash`      | `string`  | A scrypt-hashed API key for the agent.                         |
| `salt`            | `string`  | The salt used for hashing the API key.                         |
| `ip`              | `string`  | The last known IP address of the agent.                        |
| `agentVersion`    | `string`  | The version of the agent software.                             |
| `createdAt`       | `Timestamp` | Timestamp when the server was first registered.                |
| `linkedAt`        | `Timestamp` | Timestamp when the server was successfully linked.             |
| `expiresAt`       | `Timestamp` | Timestamp when the claim token expires (for pending servers).  |
| `lastSeen`        | `Timestamp` | Timestamp of the last successful communication from the agent. |

### 3. Media

- **Path**: `/users/{uid}/media/{mediaId}`
- **Description**: Stores metadata for a single media item (movie or TV episode). `mediaId` is a stable hash to prevent duplicates.

| Field         | Type      | Description                                       |
|---------------|-----------|---------------------------------------------------|
| `mediaId`     | `string`  | Stable hash or normalized path key.               |
| `title`       | `string`  | The title of the media.                           |
| `type`        | `string`  | `'movie'` \| `'episode'`                          |
| `season`      | `number`  | Season number (for episodes).                     |
| `episode`     | `number`  | Episode number (for episodes).                    |
| `year`        | `number`  | Release year.                                     |
| `filename`    | `string`  | The original filename.                            |
| `path`        | `string`  | The full path on the NAS.                         |
| `serverId`    | `string`  | The ID of the server this media belongs to.       |
| `codec`       | `string`  | The video/audio codec.                            |
| `size`        | `number`  | File size in bytes.                               |
| `duration`    | `number`  | Duration in seconds.                              |
| `posterUrl`   | `string`  | URL for the poster image.                         |
| `backdropUrl` | `string`  | URL for the backdrop image.                       |
| `tmdbId`      | `number`  | The Movie Database ID for enriched metadata.      |
| `status`      | `string`  | `'indexed'` \| `'updating'` \| `'error'`        |
| `addedAt`     | `Timestamp` | Timestamp when the media was first added.         |
| `updatedAt`   | `Timestamp` | Timestamp of the last metadata update.            |
| `playCount`   | `number`  | Denormalized count of total plays.                |

### 4. Playback

- **Path**: `/users/{uid}/playback/{mediaId}`
- **Description**: Tracks the playback progress for a specific media item.

| Field          | Type      | Description                         |
|----------------|-----------|-------------------------------------|
| `mediaId`      | `string`  | The ID of the media being tracked.  |
| `lastPosition` | `number`  | Last playback position in seconds.  |
| `duration`     | `number`  | Total duration of the media in seconds. |
| `lastPlayedAt` | `Timestamp` | Timestamp of the last playback event. |
| `playCount`    | `number`  | Total number of plays.              |

### 5. Collections

- **Path**: `/users/{uid}/collections/{collectionId}`
- **Description**: User-curated collections of media items.

| Field               | Type      | Description                                                                        |
|---------------------|-----------|------------------------------------------------------------------------------------|
| `collectionId`      | `string`  | A unique identifier for the collection.                                            |
| `name`              | `string`  | The name of the collection (e.g., "MCU Phase One").                                |
| `contentIds`        | `array`   | An array of `mediaId` strings belonging to this collection.                        |
| `hidden`            | `boolean` | Whether the collection is hidden from the main UI.                                 |
| `presentationStyle` | `string`  | Visual hint for the UI: `'single_horizontal'`, `'dual_horizontal'`, etc.           |
| `createdAt`         | `Timestamp` | Timestamp when the collection was created.                                         |
| `updatedAt`         | `Timestamp` | Timestamp when the collection was last updated.                                    |

### 6. Servers Meta

- **Path**: `/users/{uid}/servers_meta/rateLimit`
- **Description**: Stores metadata related to server operations, like rate limiting. A singleton document.

| Field                | Type      | Description                               |
|----------------------|-----------|-------------------------------------------|
| `lastTokenCreatedAt` | `Timestamp` | Timestamp of the last API token creation. |
| `rateLimitedUntil`   | `Timestamp` | Timestamp until which creation is blocked. |
