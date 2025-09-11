
"use client";

import { ENV } from './env';

const BASE_URL = ENV.AGENT_CLAIM_URL.replace(/\/agentClaim\/?$/, '');

if (!BASE_URL && process.env.NODE_ENV !== 'test') {
    console.warn("Could not determine base URL for Cloud Functions from AGENT_CLAIM_URL. API calls may fail.");
}

/**
 * A generic client-side fetcher for calling Firebase Cloud Functions.
 * It automatically includes the Firebase Auth ID token for authenticated requests.
 * @param name The name of the function to call (e.g., 'tmdbSearch').
 * @param body The JSON body to send with the POST request.
 * @param idToken The Firebase Auth ID token for the signed-in user.
 * @returns The JSON response from the function.
 */
export async function callFunction<T>(name: string, body: any, idToken: string): Promise<T> {
  if (!BASE_URL) {
    throw new Error("Cannot call function: Base URL for functions is not configured.");
  }
  const url = `${BASE_URL}/${name}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!response.ok) {
    const errorMessage = result?.error?.message || `Function '${name}' failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return result as T;
}
