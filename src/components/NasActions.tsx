
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
import { useAuthUser } from "@/hooks/useAuthUser";
import { callFunction } from "@/lib/api";

interface NasActionsProps {
  servers: ServerDoc[];
}

export default function NasActions({ servers }: NasActionsProps) {
  const { toast } = useToast();
  const { user } = useAuthUser();
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
    if (!user) {
        setError("You must be logged in to perform this action.");
        return;
    }

    const server = linkedServers.find(s => s.serverId === selectedServerId);
    if (!server) {
      setError("The selected server could not be found.");
      return;
    }

    setIsSyncing(true);
    setError(null);
    
    try {
      toast({
        title: "Sync Initiated",
        description: `Asking "${server.name || server.serverId}" to scan and sync its library...`,
      });

      const idToken = await user.getIdToken(true);
      const responseBody = await callFunction("triggerAgentSync", { serverId: selectedServerId }, idToken);

      const sentCount = (responseBody as any).sentItems || 0;
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${sentCount} items from your agent. Your libraries will now reflect the changes.`,
      });
    } catch (e: any) {
      console.error("Sync failed:", e);
      setError(`Failed to trigger sync for agent. Please ensure it's online and accessible from the cloud.`);
      toast({
        title: "Sync Failed",
        description: e.message || "Could not connect to the agent via the cloud proxy.",
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
