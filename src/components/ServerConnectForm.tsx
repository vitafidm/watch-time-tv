
"use client";

import { FormEvent, useState } from "react";
import { useServerConfig } from "@/lib/hooks/useServerConfig";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertCircle, Link, Check, RefreshCw } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function isValidUrl(s: string) {
  try {
    const u = new URL(s);
    return !!u.protocol && !!u.host && (u.protocol === "http:" || u.protocol === "https:");
  } catch {
    return false;
  }
}

export default function ServerConnectForm() {
  const { authed, config, setConfig, loading, saving, persist } = useServerConfig();
  const [error, setError] = useState("");
  const { toast } = useToast();

  if (loading) {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
            </CardHeader>
            <CardContent className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </CardContent>
        </Card>
    );
  }
  
  if (!authed) {
    return null; // The parent page `Settings` handles the main auth gate.
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const backendUrl = (config.backendUrl || "").trim();
    const moviesPath = (config.mediaRoots?.moviesPath || "").trim();
    const tvPath = (config.mediaRoots?.tvPath || "").trim();

    if (!backendUrl || !isValidUrl(backendUrl)) {
      setError("Please enter a valid Backend URL, including http:// or https://.");
      return;
    }
    if (!moviesPath || !tvPath) {
      setError("Please provide the full paths for both your Movies and TV Shows folders.");
      return;
    }

    try {
      await persist({
        provider: "direct",
        backendUrl,
        mediaRoots: { moviesPath, tvPath },
      });
      toast({
        title: "Settings Saved",
        description: "Your direct connection settings have been updated.",
      });
    } catch (err: any) {
      setError(err?.message ?? "Failed to save settings. Please try again.");
    }
  }

  const handleTestConnection = () => {
    toast({
      title: "Coming Soon!",
      description: "We'll wire this to a real connection test after the backend is implemented.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct NAS Connection</CardTitle>
        <CardDescription>
          For advanced users. Point the app directly at your self-hosted media server backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="backendUrl">Backend URL</Label>
            <Input
              id="backendUrl"
              placeholder="http://192.168.1.50:4000"
              value={config.backendUrl ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, backendUrl: e.target.value }))}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="moviesPath">Movies Folder Path</Label>
            <Input
              id="moviesPath"
              placeholder="/volume1/Media/Movies"
              value={config.mediaRoots?.moviesPath ?? ""}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  mediaRoots: { ...(c.mediaRoots || {}), moviesPath: e.target.value },
                }))
              }
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tvPath">TV Shows Folder Path</Label>
            <Input
              id="tvPath"
              placeholder="/volume1/Media/TV Shows"
              value={config.mediaRoots?.tvPath ?? ""}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  mediaRoots: { ...(c.mediaRoots || {}), tvPath: e.target.value },
                }))
              }
              disabled={saving}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Validation Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-4">
            <Button type="submit" disabled={saving}>
              {saving ? <RefreshCw className="mr-2 animate-spin" /> : <Check />}
              {saving ? "Saving…" : "Save Settings"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={saving}
            >
              <Link className="mr-2" />
              Test Connection
            </Button>
          </div>

        </form>
      </CardContent>
    </Card>
  );
}
