"use client";

import { ENV } from './env';

// Derive the base URL for Cloud Functions from environment
const BASE_URL = ENV.CLAIM_TOKEN_URL
  ? ENV.CLAIM_TOKEN_URL.replace(/\/claimToken\/?$/, "")
  : "";

if (!BASE_URL && process.env.NODE_ENV !== "development" && typeof window !== "undefined") {
  console.warn(
    "Could not determine base URL for Cloud Functions from NEXT_PUBLIC_CLAIM_TOKEN_URL. API calls may fail."
  );
}

/**
 * Generic fetcher for Firebase Cloud Functions.
 * Includes Firebase Auth ID token for authenticated requests.
 */
export async function callFunction<T>(
  name: string,
  body: any,
  idToken: string
): Promise<T> {
  if (!BASE_URL) {
    throw new Error(
      "Cannot call function: Base URL for functions is not configured in environment variables."
    );
  }

  const url = `${BASE_URL}/${name}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  let result: any = null;

  // Handle cases where server returns no body (204, connection closed, etc.)
  if (response.status !== 204) {
    try {
      result = await response.json();
    } catch {
      const text = await response.text().catch(() => "");
      result = text ? { text } : {};
    }
  }

  if (!response.ok) {
    const errorMessage =
      result?.error?.message ||
      result?.text ||
      `Function '${name}' failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return (result ?? {}) as T;
}
