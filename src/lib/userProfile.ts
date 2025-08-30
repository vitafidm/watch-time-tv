// src/lib/userProfile.ts
import { db } from "@/lib/firebase"; // adjust path if your firebase file lives elsewhere
import { doc, setDoc, getDoc } from "firebase/firestore";

export type ServerProvider = "direct";

export interface ServerConfig {
  provider: ServerProvider;              // always "direct"
  backendUrl: string;                    // e.g., http://192.168.1.50:4000
  mediaRoots: {
    moviesPath: string;                  // e.g., /volume1/Media/Movies
    tvPath: string;                      // e.g., /volume1/Media/TV
  };
  updatedAt?: number;
}

export async function saveServerConfig(uid: string, serverConfig: ServerConfig) {
  const payload = { serverConfig: { ...serverConfig, updatedAt: Date.now() } };
  await setDoc(doc(db, "users", uid), payload, { merge: true });
}

export async function loadServerConfig(uid: string): Promise<ServerConfig | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const sc = snap.data()?.serverConfig as ServerConfig | undefined;
  return sc ?? null;
}
