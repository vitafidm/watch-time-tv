// src/functions/lib/admin.ts
import * as admin from 'firebase-admin';

// Initialize exactly once, even if imported from multiple modules
if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const db = admin.firestore();
export { admin };
