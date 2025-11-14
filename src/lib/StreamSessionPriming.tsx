// src/components/player/StreamSessionPriming.tsx
import { useEffect } from "react";
import { auth } from "@/lib/firebase.client";
import { primeStreamSession } from "@/lib/primeStreamSession";

export function StreamSessionPriming({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Guard: only try if logged in and auth is available
      if (!auth?.currentUser) return;

      try {
        await primeStreamSession(() => auth.currentUser!.getIdToken(true));
        if (!cancelled) onReady();
      } catch (err) {
        console.error("[stream] prime session failed:", err);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  return null;
}
