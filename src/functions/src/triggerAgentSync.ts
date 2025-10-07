// functions/triggerAgentSync.ts
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { db } from "./initFirebase";

if (!admin.apps.length) admin.initializeApp();
const corsHandler = cors({ origin: true });

type LibrarySection = "movies" | "tv";

export default functions
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      try {
        // Only POST
        if (req.method !== "POST") {
          return res.status(405).json({ error: { code: "method-not-allowed", message: "Use POST" } });
        }

        // --- Auth ---
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
          throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
        }
        const idToken = authHeader.substring("Bearer ".length);
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded?.uid;
        if (!uid) {
          throw new functions.https.HttpsError("unauthenticated", "Invalid ID token.");
        }

        // --- Inputs ---
        const { serverId, librarySection }: { serverId: string; librarySection?: LibrarySection } = req.body || {};
        if (!serverId || typeof serverId !== "string") {
          throw new functions.https.HttpsError("invalid-argument", "Missing or invalid 'serverId'.");
        }
        if (librarySection && librarySection !== "movies" && librarySection !== "tv") {
          throw new functions.https.HttpsError("invalid-argument", "librarySection must be 'movies' or 'tv' if provided.");
        }

        // (Optional) Verify server exists & belongs to user (keeps UX honest)
        const serverRef = db.doc(`users/${uid}/servers/${serverId}`);
        const serverSnap = await serverRef.get();
        if (!serverSnap.exists) {
          throw new functions.https.HttpsError("not-found", `Server '${serverId}' not found for user.`);
        }

        // --- Create job document for agent to pick up ---
        // Agent should poll/watch users/{uid}/agentJobs where status == "queued" and serverId matches its own identity.
        const jobRef = db.collection(`users/${uid}/agentJobs`).doc();
        const now = admin.firestore.FieldValue.serverTimestamp();

        // Build the payload carefully: NEVER include undefined Firestore values.
        const jobPayload: Record<string, any> = {
          action: "sync",                  // tells the agent what to do
          status: "queued",                // queued -> running -> done/error
          serverId,                        // address the job to a specific agent
          createdAt: now,
          updatedAt: now,
          createdBy: uid,
          // optional filters
          librarySection: librarySection ?? null,
          // optional progress scaffold
          progress: { scanned: 0, upserted: 0, skipped: 0, errors: 0 },
        };

        await jobRef.set(jobPayload, { merge: false });

        // Return job info so UI can subscribe/poll for status
        return res.status(200).json({
          jobId: jobRef.id,
          status: "queued",
          serverId,
          librarySection: librarySection ?? null,
        });
      } catch (err: any) {
        functions.logger.error("triggerAgentSync error", err);
        const code = err?.code || "internal";
        const message = err?.message || "Internal error.";
        const http =
          code === "unauthenticated" ? 401 :
          code === "permission-denied" ? 403 :
          code === "not-found" ? 404 :
          code === "invalid-argument" ? 400 :
          500;
        return res.status(http).json({ error: { code, message } });
      }
    });
  });
