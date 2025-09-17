"use client";

import {
  useEffect,
  useMemo,
  useState,
  createContext,
  useContext,
  ReactNode,
} from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase.client";
import { loadServerConfig, saveServerConfig, ServerConfig } from "@/lib/userProfile";

type Ctx = {
  user: User | null;
  config: ServerConfig | null;
  loading: boolean;
  save: (cfg: Partial<ServerConfig>) => Promise<void>;
};

const ServerConfigContext = createContext<Ctx | undefined>(undefined);

export function ServerConfigProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setConfig(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const cfg = await loadServerConfig(u.uid);
        setConfig(cfg ?? null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const save = async (patch: Partial<ServerConfig>) => {
    if (!user) return;
    const next = { ...(config ?? {}), ...patch } as ServerConfig;
    await saveServerConfig(user.uid, next);
    setConfig(next);
  };

  const value = useMemo(
    () => ({ user, config, loading, save }),
    [user, config, loading]
  );

  return (
    <ServerConfigContext.Provider value={value}>
      {children}
    </ServerConfigContext.Provider>
  );
}

export function useServerConfig() {
  const ctx = useContext(ServerConfigContext);
  if (ctx === undefined) {
    throw new Error("useServerConfig must be used within a ServerConfigProvider");
  }
  return ctx;
}
