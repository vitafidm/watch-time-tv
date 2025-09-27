// src/preinit-admin.ts
import * as admin from "firebase-admin";

// Initialize the default Admin app exactly once, as early as possible.
if (!admin.apps.length) {
  admin.initializeApp();
}

// Nothing to export; the side-effect is the point.
