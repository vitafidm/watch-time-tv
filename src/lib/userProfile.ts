// src/lib/userProfile.ts
import { db } from "@/lib/firebase"; 
import { doc, setDoc, getDoc } from "firebase/firestore";

export type ServerProvider = "direct";

export interface ServerConfig {
  provider: ServerProvider;              
  backendUrl: string;                    
  serverId?: string;                     
  mediaRoots: {
    moviesPath: string;                  
    tvPath: string;                      
  };
  updatedAt?: number;
}

export async function saveServerConfig(uid: string, serverConfig: ServerConfig) {
  // FIX: Save to the "config" document inside the "serverConfig" sub-collection
  // WAS: setDoc(doc(db, "users", uid), { serverConfig: ... }, { merge: true });
  await setDoc(
    doc(db, "users", uid, "serverConfig", "config"), 
    { ...serverConfig, updatedAt: Date.now() }, 
    { merge: true }
  );
}

export async function loadServerConfig(uid: string): Promise<ServerConfig | null> {
  // FIX: Load from the "config" document inside the "serverConfig" sub-collection
  // WAS: const snap = await getDoc(doc(db, "users", uid));
  const snap = await getDoc(doc(db, "users", uid, "serverConfig", "config"));
  
  if (!snap.exists()) return null;
  
  // The data is directly in the document now, not nested under "serverConfig"
  return snap.data() as ServerConfig;
}