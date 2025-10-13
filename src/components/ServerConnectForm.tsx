
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useServerConfig } from "@/hooks/useServerConfig";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function isValidUrl(s: string) {
  try {
    const u = new URL(s);
    return !!u.protocol && !!u.host && (u.protocol === "http:" || u.protocol === "https://:");
  } catch {
    return false;
  }
}

export default function ServerConnectForm() {
  const { user, config, loading, save } = useServerConfig();
  const { toast } = useToast();

  const [backendUrl, setBackendUrl] = useState("");
  const [moviesPath, setMoviesPath] = useState("");
  const [tvPath, setTvPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  
  useEffect(() => {
    if (config) {
        setBackendUrl(config.backendUrl || "");
        setMoviesPath(config.mediaRoots?.moviesPath || "");
        setTvPath(config.mediaRoots?.tvPath || "");
    }
  }, [config]);


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
                <Skeleton className="h-10 w-24" />
            </CardContent>
        </Card>
    );
  }
  
  if (!user) {
    return null; // The parent page `Settings` handles the main auth gate.
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const finalBackendUrl = backendUrl.trim();
    const finalMoviesPath = moviesPath.trim();
    const finalTvPath = tvPath.trim();

    if (!finalBackendUrl || !isValidUrl(finalBackendUrl)) {
      setError("Please enter a valid Backend URL, including http:// or https://.");
      return;
    }
    if (!finalMoviesPath || !finalTvPath) {
      setError("Please provide the full paths for both your Movies and TV Shows folders.");
      return;
    }

    setSaving(true);
    try {
      await save({
        provider: "direct",
        backendUrl: finalBackendUrl,
        mediaRoots: { moviesPath: finalMoviesPath, tvPath: finalTvPath },
      });
      toast({
        title: "Settings Saved",
        description: "Your direct connection settings have been updated.",
      });
    } catch (err: any) {
      setError(err?.message ?? "Failed to save settings. Please try again.");
    } finally {
        setSaving(false);
    }
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
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="moviesPath">Movies Folder Path</Label>
            <Input
              id="moviesPath"
              placeholder="/volume1/Media/Movies"
              value={moviesPath}
              onChange={(e) => setMoviesPath(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tvPath">TV Shows Folder Path</Label>
            <Input
              id="tvPath"
              placeholder="/volume1/Media/TV Shows"
              value={tvPath}
              onChange={(e) => setTvPath(e.target.value)}
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
          </div>

        </form>
      </CardContent>
    </Card>
  );
}
