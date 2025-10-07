"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// 🔥 Firestore client (assumes Firebase app is already initialized in your app)
import { getApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, Unsubscribe } from "firebase/firestore";

interface NasActionsProps {
  servers: ServerDoc[];
}

type JobStatus = "queued" | "running" | "done" | "error";

type JobDoc = {
  status: JobStatus;
  action: "sync" | string;
  serverId: string;
  createdAt?: any;
  updatedAt?: any;
  startedAt?: any;
  finishedAt?: any;
  errorMessage?: string | null;
  // optional progress payload written by the agent
  progress?: {
    scanned?: number;
    sentItems?: number;
    postedBatches?: number;
    errors?: number;
  };
};

export default function NasActions({ servers }: NasActionsProps) {
  const { toast } = useToast();
  const { user } = useAuthUser();

  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Job tracking
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | "idle">("idle");
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<Required<JobDoc>["progress"] | null>(null);

  const unsubRef = useRef<Unsubscribe | null>(null);

  const linkedServers = useMemo(
    () => servers.filter((s) => s.status === "linked"),
    [servers]
  );

  useEffect(() => {
    // Pre-select the server if there's only one
    if (linkedServers.length === 1 && !selectedServerId) {
      setSelectedServerId(linkedServers[0].serverId);
    }
    // Clear selection if the selected server is no longer available
    if (selectedServerId && !linkedServers.some((s) => s.serverId === selectedServerId)) {
      setSelectedServerId("");
    }
  }, [linkedServers, selectedServerId]);

  // Subscribe to the job doc when we have jobId + user
  useEffect(() => {
    // Cleanup any previous listener first
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    setJobProgress(null);
    setJobError(null);

    if (!user || !jobId) return;

    try {
      const db = getFirestore(getApp());
      const jobRef = doc(db, `users/${user.uid}/agentJobs/${jobId}`);

      const unsub = onSnapshot(
        jobRef,
        (snap) => {
          if (!snap.exists()) return;
          const data = (snap.data() || {}) as JobDoc;
          setJobStatus(data.status || "queued");
          setJobProgress(data.progress || null);
          setJobError(data.errorMessage || null);

          if (data.status === "done") {
            toast({
              title: "Sync Complete",
              description: `Scanned ${data.progress?.scanned ?? 0} items, sent ${data.progress?.sentItems ?? 0}.`,
            });
            setIsSyncing(false);
          } else if (data.status === "error") {
            toast({
              title: "Sync Failed",
              description: data.errorMessage || "The agent reported an error during sync.",
              variant: "destructive",
            });
            setIsSyncing(false);
          }
        },
        (err) => {
          console.error("Job onSnapshot error:", err);
          setJobError(err.message || "Failed to watch job status.");
          setIsSyncing(false);
        }
      );

      unsubRef.current = unsub;
    } catch (e: any) {
      console.error("Failed to attach job listener:", e);
      setJobError(e?.message || "Could not attach job listener.");
      setIsSyncing(false);
    }

    // Cleanup on unmount or job change
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [user, jobId, toast]);

  const handleSync = async () => {
    setError(null);
    setJobError(null);

    if (!selectedServerId) {
      setError("Please select a server to sync.");
      return;
    }
    if (!user) {
      setError("You must be logged in to perform this action.");
      return;
    }

    const server = linkedServers.find((s) => s.serverId === selectedServerId);
    if (!server) {
      setError("The selected server could not be found.");
      return;
    }

    try {
      setIsSyncing(true);
      setJobStatus("queued");
      setJobId(null); // reset any previous job
      setJobProgress(null);

      toast({
        title: "Sync Requested",
        description: `Creating a sync job for "${server.name || server.serverId}"...`,
      });

      const idToken = await user.getIdToken(true);
      // New behavior: the CF should return { jobId }
      const resp: any = await callFunction(
        "triggerAgentSync",
        { serverId: selectedServerId },
        idToken
      );

      const returnedJobId = resp?.jobId as string | undefined;
      if (!returnedJobId) {
        // Fallback (legacy): if your CF still responds with a direct summary, show it
        // But we’ll mark this as an error to guide you to the new flow.
        setIsSyncing(false);
        setError(
          "The sync function did not return a jobId. Make sure triggerAgentSync is using the job-queue pattern."
        );
        toast({
          title: "Sync Error",
          description:
            "No jobId returned by triggerAgentSync. Please update the backend to the job-queue flow.",
          variant: "destructive",
        });
        return;
      }

      setJobId(returnedJobId);
      setJobStatus("queued");

      toast({
        title: "Sync Job Created",
        description: "Watching job status… your agent will start within ~15s.",
      });
    } catch (e: any) {
      console.error("Sync failed:", e);
      setIsSyncing(false);
      setError(
        e?.message ||
          "Failed to create a sync job. Please verify you're logged in and the cloud function is deployed."
      );
      toast({
        title: "Sync Failed",
        description:
          e?.message ||
          "Could not create a sync job. Check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  const isBusy = isSyncing || jobStatus === "queued" || jobStatus === "running";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Library Sync</CardTitle>
        <CardDescription>
          Create a sync job for your connected agent. The agent will scan for new media
          and push a catalog to your cloud library. Progress updates appear here live.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linkedServers.length > 0 ? (
          <div className="space-y-4">
            <div
              className={cn(
                "grid gap-2",
                linkedServers.length === 1 && "grid-cols-[1fr,auto]"
              )}
            >
              <Select
                value={selectedServerId}
                onValueChange={setSelectedServerId}
                disabled={isBusy}
              >
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

            <Button
              onClick={handleSync}
              disabled={!selectedServerId || isBusy}
              className="w-full sm:w-auto"
            >
              <RefreshCw
                className={cn("mr-2 h-4 w-4", isBusy && "animate-spin")}
              />
              {isBusy ? "Syncing…" : "Sync Library from Agent"}
            </Button>

            {(jobStatus !== "idle" || jobId) && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">
                      Job Status:{" "}
                      <span
                        className={cn(
                          jobStatus === "done" && "text-green-500",
                          jobStatus === "error" && "text-red-500",
                          (jobStatus === "queued" || jobStatus === "running") &&
                            "text-blue-500"
                        )}
                      >
                        {jobStatus}
                      </span>
                    </div>
                    {jobId && <div className="mt-0.5">Job ID: {jobId}</div>}
                  </div>
                  {(jobStatus === "queued" || jobStatus === "running") && (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  )}
                </div>

                {jobProgress && (
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
                    <div>
                      Scanned:{" "}
                      <span className="text-foreground font-medium">
                        {jobProgress.scanned ?? 0}
                      </span>
                    </div>
                    <div>
                      Sent:{" "}
                      <span className="text-foreground font-medium">
                        {jobProgress.sentItems ?? 0}
                      </span>
                    </div>
                    <div>
                      Batches:{" "}
                      <span className="text-foreground font-medium">
                        {jobProgress.postedBatches ?? 0}
                      </span>
                    </div>
                    <div>
                      Errors:{" "}
                      <span className="text-foreground font-medium">
                        {jobProgress.errors ?? 0}
                      </span>
                    </div>
                  </div>
                )}

                {jobError && (
                  <div className="mt-2 text-red-500">
                    Error: <span className="text-foreground">{jobError}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center p-4 rounded-md bg-muted text-muted-foreground text-sm">
            <Server className="mr-2 h-4 w-4" />
            Connect an agent to enable library syncing.
          </div>
        )}

        {(error || jobStatus === "error") && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error || jobError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
