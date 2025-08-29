
"use client";

import { getAuth } from "firebase/auth";

export async function reportPlayback(apiUrl: string, payload: {
  mediaId: string;
  position: number;
  duration: number;
  finished?: boolean;
}) {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not signed in");
  const idToken = await user.getIdToken(true);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Playback report failed: ${res.status}`);
  }

  return res.json();
}

export function createPlaybackThrottler(intervalMs = 10_000) {
  let lastAt = 0;
  return async (fn: () => Promise<any>) => {
    const now = Date.now();
    if (now - lastAt < intervalMs) return;
    lastAt = now;
    return fn();
  };
}
