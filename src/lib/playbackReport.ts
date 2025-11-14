// src/lib/playbackReport.ts
import { getAuth } from "firebase/auth";

const RAW_BASE =
  process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ||
  "http://localhost:5001/watchtimetv2/us-central1"; // local emulator fallback

// Normalize (strip trailing slash)
const BASE = RAW_BASE.replace(/\/+$/, "");

type Payload = {
  mediaId: string;
  position: number; // seconds
  duration: number; // seconds
  finished?: boolean;
};

/**
 * Post a playback progress report to the Cloud Function.
 * Auth: attaches Firebase ID token in Authorization header.
 * Endpoint must be deployed as "playbackReport".
 */
export async function postPlaybackReport(payload: Payload): Promise<void> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken(true);
  if (!token) throw new Error("Not signed in");

  const res = await fetch(`${BASE}/playbackReport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "omit",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `playbackReport HTTP ${res.status}`);
  }
}
