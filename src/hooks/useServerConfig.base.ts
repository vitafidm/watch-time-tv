// src/hooks/useServerConfig.ts
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { loadServerConfig, saveServerConfig, ServerConfig } from "@/lib/userProfile";

const DEFAULTS: ServerConfig = {
  provider: "direct",
  backendUrl: "",
  mediaRoots: { moviesPath: "", tvPath: "" }
};

export function useServerConfig() {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<ServerConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const authed = useMemo(() => !!user, [user]);

  useEffect(() => {
    const off = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setConfig(DEFAULTS);
        setLoading(false);
        return;
      }
      const sc = await loadServerConfig(u.uid);
      setConfig(sc ?? DEFAULTS);
      setLoading(false);
    });
    return () => off();
  }, []);

  async function persist(next: ServerConfig) {
    if (!user) throw new Error("Not signed in");
    setSaving(true);
    try {
      await saveServerConfig(user.uid, next);
      setConfig(next);
    } finally {
      setSaving(false);
    }
  }

  return { authed, user, config, setConfig, loading, saving, persist };
}
