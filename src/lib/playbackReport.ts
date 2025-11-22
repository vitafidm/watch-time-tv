// src/lib/playbackReport.ts
import { getAuth } from "firebase/auth";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase.client";

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

/**
 * Hard "mark as watched":
 * Deletes the playback doc at users/{uid}/playback/{mediaId}.
 * This will drop the item from Continue Watching (and clear progress bars).
 */
export async function markPlaybackFinished(
  mediaId: string | number
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const ref = doc(db, "users", user.uid, "playback", String(mediaId));
  await deleteDoc(ref);
}
