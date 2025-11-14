"use client";

import { useEffect, useRef } from "react";
import { useAuthUser } from "@/hooks/useAuthUser";
import { primeStreamSession } from "@/lib/primeStreamSession";
import { auth } from "@/lib/firebase.client";

export function StreamSessionPriming() {
  const { user } = useAuthUser();
  const doneForUid = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!user) return;
      // avoid re-priming on every render / token refresh
      if (doneForUid.current === user.uid) return;
      try {
        const idToken = await user.getIdToken(true);
        await primeStreamSession(() => auth.currentUser!.getIdToken(true));
        doneForUid.current = user.uid;
      } catch (e) {
        console.warn("[stream] prime session failed:", e);
      }
    })();
  }, [user]);

  return null;
}
