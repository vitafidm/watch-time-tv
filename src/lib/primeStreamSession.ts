// src/lib/primeStreamSession.ts
type TokenInput = string | Promise<string> | (() => Promise<string>);

export async function primeStreamSession(getIdTokenInput: TokenInput) {
  // Normalize whatever the caller passed into an actual string token.
  const getToken = async (): Promise<string> => {
    if (typeof getIdTokenInput === "function") return await getIdTokenInput();
    if (typeof getIdTokenInput === "string") {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[primeStreamSession] received raw token string; prefer () => Promise<string> to avoid stale tokens."
        );
      }
      return getIdTokenInput;
    }
    // It's a Promise<string>
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[primeStreamSession] received Promise<string>; prefer () => Promise<string> to avoid stale tokens."
      );
    }
    return await getIdTokenInput;
  };

  const base =
    process.env.NEXT_PUBLIC_STREAM_ORIGIN?.replace(/\/$/, "") ||
    "https://bendersass.home/pc-hls";

  const idToken = await getToken();

  const res = await fetch(`${base}/session`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ idToken }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `prime session failed: ${res.status}`);
  }
}
