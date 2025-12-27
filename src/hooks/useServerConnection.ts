import { useState, useEffect, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

type ConnectionState = "idle" | "searching" | "connected" | "offline";

interface ServerStatusDoc {
  ip?: { local?: string; public?: string };
  connection?: { local?: string; public?: string };
  lastSeen?: any;
}

export function useServerConnection(
  uid: string | undefined,
  serverId: string | undefined,
  fallbackUrl: string
) {
  // Default to fallback, but mark as searching initially
  const [activeUrl, setActiveUrl] = useState<string>(fallbackUrl);
  const [status, setStatus] = useState<ConnectionState>("searching");
  
  useEffect(() => {
    if (!uid || !serverId) {
      setActiveUrl(fallbackUrl);
      setStatus("connected"); 
      return;
    }

    setStatus("searching");

    const serverDocRef = doc(db, "users", uid, "servers", serverId);
    
    const unsubscribe = onSnapshot(serverDocRef, async (snap) => {
      if (!snap.exists()) return;
      
      const data = snap.data() as ServerStatusDoc;
      const local = data.connection?.local;
      const pub   = data.connection?.public;

      // --- NEW LOGIC: Trust HTTPS Immediately ---
      
      // 1. If Local URL is HTTPS, it wins instantly. No ping check.
      if (local && local.startsWith("https://")) {
        console.log(`[Discovery] Trusting Secure Local: ${local}`);
        setActiveUrl(local);
        setStatus("connected");
        return;
      }

      // 2. If Public URL is HTTPS, it's the runner up.
      if (pub && pub.startsWith("https://")) {
        console.log(`[Discovery] Trusting Secure Public: ${pub}`);
        setActiveUrl(pub);
        setStatus("connected");
        return;
      }

      // 3. If we are here, we only have insecure HTTP options.
      // If the app is running on HTTPS, these WILL fail, but we'll try the race anyway.
      const candidates: string[] = [];
      if (local) candidates.push(local);
      if (pub) candidates.push(pub);
      // Only add fallback if we really have nothing else
      if (candidates.length === 0 && fallbackUrl) {
         candidates.push(fallbackUrl);
      }

      if (candidates.length === 0) {
        setStatus("offline");
        return;
      }

      // 4. Fallback Race (Only runs if no HTTPS options found)
      const winner = await raceConnections(candidates);
      if (winner) {
        console.log(`[Discovery] Winner (Insecure): ${winner}`);
        setActiveUrl(winner);
        setStatus("connected");
      } else {
        console.warn("[Discovery] All connection paths failed.");
        setStatus("offline");
      }
    });

    return () => unsubscribe();
  }, [uid, serverId, fallbackUrl]);

  return { activeUrl, status };
}

// --- Helper: The Race Logic (Unchanged) ---
async function raceConnections(urls: string[]): Promise<string | null> {
  const checks = urls.map(async (url) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${url}/health`, { 
        method: "GET", 
        signal: controller.signal,
        mode: 'cors' 
      });
      clearTimeout(id);
      if (res.ok) return url;
      throw new Error("Not OK");
    } catch (e: any) {
      throw e;
    }
  });

  try {
    return await Promise.any(checks);
  } catch {
    return null; 
  }
}