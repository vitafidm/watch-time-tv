"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RefreshCw, AlertCircle, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ServerDoc } from "@/lib/db.types";
import { cn } from "@/lib/utils";

interface NasActionsProps {
  servers: ServerDoc[];
}

export default function NasActions({ servers }: NasActionsProps) {
  const { toast } = useToast();
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const linkedServers = servers.filter((s) => s.status === 'linked');

  useEffect(() => {
    // Pre-select the server if there's only one
    if (linkedServers.length === 1 && !selectedServerId) {
      setSelectedServerId(linkedServers[0].serverId);
    }
    // Clear selection if the selected server is no longer available
    if (selectedServerId && !linkedServers.some(s => s.serverId === selectedServerId)) {
        setSelectedServerId("");
    }
  }, [linkedServers, selectedServerId]);

  const handleSync = async () => {
    if (!selectedServerId) {
      setError("Please select a server to sync.");
      return;
    }

    const server = linkedServers.find(s => s.serverId === selectedServerId);
    if (!server || !server.ip) {
      setError("The selected server does not have a valid IP address configured.");
      toast({
        title: "Sync Failed",
        description: "Selected server is missing an IP address.",
        variant: "destructive",
      });
      return;
    }

    setIsSyncing(true);
    setError(null);
    
    // The agent runs on port 4010 by default
    const agentUrl = `http://${server.ip}:4010/sync`;

    try {
      toast({
        title: "Sync Initiated",
        description: `Asking "${server.name || server.serverId}" to scan and sync its library...`,
      });

      const response = await fetch(agentUrl, { method: "POST" });
      const responseBody = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(responseBody.error || `Agent returned an error: ${response.status}`);
      }

      const sentCount = responseBody.sentItems || 0;
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${sentCount} items from your agent. Your libraries will now reflect the changes.`,
      });
    } catch (e: any) {
      console.error("Sync failed:", e);
      setError(`Failed to connect to agent at ${agentUrl}. Ensure it's running and accessible.`);
      toast({
        title: "Sync Failed",
        description: e.message || "Could not connect to the agent.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Library Sync</CardTitle>
        <CardDescription>
          Trigger your connected agent to scan for new media and sync the catalog with your cloud library.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linkedServers.length > 0 ? (
          <div className="space-y-4">
            <div className={cn("grid gap-2", linkedServers.length === 1 && "grid-cols-[1fr,auto]")}>
                 <Select value={selectedServerId} onValueChange={setSelectedServerId} disabled={isSyncing}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select a server to sync..." />
                    </SelectTrigger>
                    <SelectContent>
                        {linkedServers.map((server) => (
                        <SelectItem key={server.serverId} value={server.serverId}>
                            {server.name || server.serverId}
                        </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <Button onClick={handleSync} disabled={!selectedServerId || isSyncing} className="w-full sm:w-auto">
              {isSyncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {isSyncing ? "Syncing..." : "Sync Library from Agent"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center p-4 rounded-md bg-muted text-muted-foreground text-sm">
            <Server className="mr-2 h-4 w-4" />
            Connect an agent to enable library syncing.
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
