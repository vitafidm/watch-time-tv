// functions/src/flows/start-playback.ts
import * as admin from "firebase-admin";
import { onRequest, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import jwt from "jsonwebtoken";
import type { Request as ExpressRequest } from "express";

// Initialize Admin SDK once
try {
  if (!admin.apps.length) admin.initializeApp();
} catch {
  /* no-op */
}

// Body shape for requests
type StartPlaybackBody = {
  mediaId: string;
};

// Helper: read "Authorization: Bearer <idToken>"
function getBearerToken(req: ExpressRequest): string | null {
  // Prefer Express's req.get(); fall back to headers
  const header =
    req.get?.("Authorization") ||
    req.get?.("authorization") ||
    (req.headers?.authorization as string | undefined) ||
    (req.headers as any)?.Authorization;

  if (!header || typeof header !== "string") return null;
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/**
 * startPlayback (HTTPS)
 * POST only. Requires Firebase ID token in Authorization header.
 * Body: { mediaId: string }
 * Returns: { url: string, expiresAt: number }
 */
export const startPlayback = onRequest(
  {
    region: "us-central1",
    cors: true,
    // Tell Functions to inject these secrets into process.env
    secrets: ["STREAM_JWT_PRIVATE_KEY", "STREAM_BASE_URL"],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).set("Allow", "POST").json({ error: "Method Not Allowed" });
        return;
      }

      // 1) Verify caller is signed in
      const idToken = getBearerToken(req as ExpressRequest);
      if (!idToken) {
        throw new HttpsError("unauthenticated", "Missing Authorization: Bearer <idToken> header.");
      }

      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(idToken);
      } catch {
        throw new HttpsError("unauthenticated", "Invalid or expired Firebase ID token.");
      }
      const uid = decoded.uid;

      // 2) Parse JSON body
      const body = (req.body ?? {}) as Partial<StartPlaybackBody>;
      const mediaId = (body.mediaId || "").trim();
      if (!mediaId) {
        throw new HttpsError("invalid-argument", "Body must include a non-empty 'mediaId' string.");
      }

      // 3) Ensure media exists for this user
      const mediaRef = admin.firestore().doc(`users/${uid}/media/${mediaId}`);
      const mediaSnap = await mediaRef.get();
      if (!mediaSnap.exists) {
        throw new HttpsError("not-found", "Media not found or not owned by this user.");
      }

      // 4) Build a short-lived JWT "ticket"
      const privateKey = process.env.STREAM_JWT_PRIVATE_KEY;
      const baseUrlRaw = process.env.STREAM_BASE_URL;
      if (!privateKey) throw new HttpsError("failed-precondition", "STREAM_JWT_PRIVATE_KEY not available.");
      if (!baseUrlRaw) throw new HttpsError("failed-precondition", "STREAM_BASE_URL not available.");

      const nowSec = Math.floor(Date.now() / 1000);
      const exp = nowSec + 5 * 60; // 5 minutes

      const token = jwt.sign(
        {
          sub: uid,     // who
          mid: mediaId, // what
          iat: nowSec,
          exp,
          ver: 1,       // version, handy for future changes
        },
        privateKey,
        { algorithm: "RS256" }
      );

      // 5) Build URL to your NAS HLS endpoint
      const baseUrl = baseUrlRaw.endsWith("/") ? baseUrlRaw.slice(0, -1) : baseUrlRaw;
      const url = `${baseUrl}/hls/${encodeURIComponent(mediaId)}/index.m3u8?token=${encodeURIComponent(token)}`;

      res.status(200).json({ url, expiresAt: exp });
    } catch (err: any) {
      logger.error("startPlayback error", err);
      const status = err?.httpErrorCode?.status || 500;
      res.status(status).json({ error: err?.message || "Internal error" });
    }
  }
);
