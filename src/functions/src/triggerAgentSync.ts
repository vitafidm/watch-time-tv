
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import fetch from "node-fetch";
import { db } from "./initFirebase";

const corsHandler = cors({ origin: true });

export default functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
      // 1. Authenticate the user
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "User must be authenticated."
        );
      }
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      // 2. Validate the request body
      const { serverId } = req.body;
      if (!serverId || typeof serverId !== "string") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "The function must be called with a 'serverId' in the body."
        );
      }

      // 3. Look up the server document to find the IP address
      const serverRef = db.doc(`users/${uid}/servers/${serverId}`);
      const serverSnap = await serverRef.get();

      if (!serverSnap.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          `Server with ID '${serverId}' not found for this user.`
        );
      }

      const serverData = serverSnap.data();
      const ip = serverData?.ip;

      if (!ip || typeof ip !== "string") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Server with ID '${serverId}' does not have a configured IP address.`
        );
      }

      // 4. Proxy the request to the local agent
      const agentUrl = `http://${ip}:4010/sync`;
      functions.logger.info(`Proxying sync request for user ${uid} to agent at ${agentUrl}`);

      const agentResponse = await fetch(agentUrl, {
        method: "POST",
        // Optional: add a timeout if agents might be slow or offline
        // timeout: 15000, 
      });

      const agentResponseBody = await agentResponse.json().catch(() => ({}));

      // 5. Relay the agent's response back to the client
      if (!agentResponse.ok) {
        functions.logger.error("Agent responded with an error", {
          status: agentResponse.status,
          body: agentResponseBody,
          agentUrl,
        });
        // Relay the agent's error status and message
        return res.status(agentResponse.status).json({
          error: {
            status: "AGENT_ERROR",
            message: (agentResponseBody as any).error || `Agent returned status ${agentResponse.status}`,
          }
        });
      }

      return res.status(200).json(agentResponseBody);

    } catch (error: any) {
      functions.logger.error("Error in triggerAgentSync:", error);
      const code = error.code || "internal";
      const message = error.message || "An internal error occurred.";
      const status = 
        code === "unauthenticated" ? 401 :
        code === "permission-denied" ? 403 :
        code === "not-found" ? 404 :
        code === "invalid-argument" ? 400 :
        code === "failed-precondition" ? 412 :
        500;
      
      return res.status(status).json({ error: { code, message } });
    }
  });
});
