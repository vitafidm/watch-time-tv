"use client";

import { useEffect, useMemo, useState, createContext, useContext, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase.client";
import { loadServerConfig, saveServerConfig, ServerConfig } from "@/lib/userProfile";

const DEFAULTS: ServerConfig = {
  provider: "direct",
  backendUrl: "",
  mediaRoots: { moviesPath: "", tvPath: "" }
};

interface ServerConfigContextType {
    config: ServerConfig;
    setConfig: React.Dispatch<React.SetStateAction<ServerConfig>>;
    loading: boolean;
    saving: boolean;
    persist: (next: ServerConfig) => Promise<void>;
    authed: boolean;
    user: User | null;
}

const ServerConfigContext = createContext<ServerConfigContextType | undefined>(undefined);

export function ServerConfigProvider({ children }: { children: ReactNode }) {
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
    
    const value = { authed, user, config, setConfig, loading, saving, persist };

    return (
        <ServerConfigContext.Provider value={value}>
        {children}
        </ServerConfigContext.Provider>
    );
}

export function useServerConfig() {
  const context = useContext(ServerConfigContext);
  if (context === undefined) {
    throw new Error('useServerConfig must be used within a ServerConfigProvider');
  }
  return context;
}
