"use client";

import { useState } from "react";
import { useAuthUser } from "@/hooks/useAuthUser";
import { callFunction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Search, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";

// Firestore imports for episode scan
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  getDocs,
  startAfter,
  type Query,
  type QuerySnapshot,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";

type ProgressState = {
  scanned: number;
  enriched: number;
  notFound: number;
  errors: number;
  skipped: number;
};

const INITIAL_PROGRESS: ProgressState = {
  scanned: 0,
  enriched: 0,
  notFound: 0,
  errors: 0,
  skipped: 0,
};

export function LibraryMaintenance() {
  const { user } = useAuthUser();
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const handleStartScan = async () => {
    if (!user) {
      setError("You must be signed in to perform this action.");
      return;
    }

    setIsScanning(true);
    setIsComplete(false);
    setError(null);
    setProgress(INITIAL_PROGRESS);

    // Movies & episodes loop (tmdbBackfillMissing)
    const runMediaScan = async (
      currentCursor: string | null,
      token: string
    ): Promise<void> => {
      const body = { uid: user.uid, processAll: true, cursor: currentCursor };
      const response: any = await callFunction("tmdbBackfillMissing", body, token);

      setProgress((prev) => ({
        scanned: prev.scanned + (response.scanned || 0),
        enriched: prev.enriched + (response.enriched || 0),
        notFound: prev.notFound + (response.notFound || 0),
        errors: prev.errors + (response.errors || 0),
        skipped: prev.skipped + (response.skipped || 0),
      }));

      if (response.nextCursor) {
        const delay = Number(response.retryAfterMs) || 11000;
        await new Promise((r) => setTimeout(r, delay));
        return runMediaScan(response.nextCursor, token);
      }
    };

    // NEW: materialize shows from episode folders (users/{uid}/shows docs)
    const runShowMaterialization = async (
      currentCursor: string | null,
      token: string
    ): Promise<void> => {
      const body = {
        pageSize: 400,
        processAll: true,
        cursor: currentCursor,
      };
      const response: any = await callFunction(
        "materializeUserShowsFromFolders",
        body,
        token
      );

      // We just fold "scanned" from this phase into the same counter
      setProgress((prev) => ({
        ...prev,
        scanned: prev.scanned + (response.scanned || 0),
      }));

      if (response.nextCursor) {
        const delay = 1000;
        await new Promise((r) => setTimeout(r, delay));
        return runShowMaterialization(response.nextCursor, token);
      }
    };

    // Shows loop (tmdbEnrichShows – enrich show docs with TMDB data, logos, extraVideos)
    const runShowScan = async (
      currentCursor: string | null,
      token: string
    ): Promise<void> => {
      const body = { uid: user.uid, cursor: currentCursor };
      const response: any = await callFunction("tmdbEnrichShows", body, token);

      setProgress((prev) => ({
        ...prev,
        scanned: prev.scanned + (response.processed || 0),
        enriched: prev.enriched + (response.enriched || 0),
        notFound: prev.notFound + (response.notFound || 0),
        errors: prev.errors + (response.errors || 0),
        skipped: prev.skipped + (response.skipped || 0),
      }));

      if (response.nextStartAfterId) {
        const delay = 1000; // light delay between show batches
        await new Promise((r) => setTimeout(r, delay));
        return runShowScan(response.nextStartAfterId, token);
      }
    };

    // Episodes loop (uses existing tmdbEnrichEpisodes function)
    const runEpisodeScan = async (token: string): Promise<void> => {
      const PAGE_SIZE = 50; // tmdbEnrichEpisodes caps at 50 items
      let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

      while (true) {
        // Only episodes whose parent show is matched and episode fields still missing
        const baseQuery: Query<DocumentData> = query(
          collection(db, `users/${user.uid}/media`),
          where("type", "==", "episode"),
          where("tmdbShowId", ">", 0),
          where("episodeTitle", "==", null),
          orderBy("tmdbShowId", "asc"),
          fbLimit(PAGE_SIZE)
        );

        // Prepare the query for this page
        const qRef: Query<DocumentData> = lastDoc
          ? query(baseQuery, startAfter(lastDoc))
          : baseQuery;

        // Type the snapshot explicitly
        const snap: QuerySnapshot<DocumentData> = await getDocs(qRef);
        if (snap.empty) break;

        // Type each doc in the map
        const items = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => {
          const data = d.data() as any;
          return {
            mediaId: d.id,
            showId: data.tmdbShowId,
            season: data.season ?? data.seasonNumber ?? 1,
            episode: data.episodeNumber ?? data.episode ?? 1,
          };
        });

        const body = { items };
        const response: any = await callFunction("tmdbEnrichEpisodes", body, token);

        const enriched = (response?.results || []).filter(
          (r: any) => r.status === "enriched"
        ).length;
        const notFound = (response?.results || []).filter(
          (r: any) => r.status === "not_found"
        ).length;
        const errors = (response?.results || []).filter(
          (r: any) => r.status === "error"
        ).length;
        const scanned = (response?.results || []).length;

        setProgress((prev) => ({
          scanned: prev.scanned + scanned,
          enriched: prev.enriched + enriched,
          notFound: prev.notFound + notFound,
          errors: prev.errors + errors,
          skipped: prev.skipped, // no explicit "skipped" from this function
        }));

        lastDoc = snap.docs[snap.docs.length - 1];

        // Gentle pacing for TMDB rate limits
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    try {
      const idToken = await user.getIdToken(true);

      // Phase 1: Movies/episodes (media-level TMDB enrichment)
      await runMediaScan(null, idToken);

      // Phase 2: Materialize /users/{uid}/shows from episode folders
      await runShowMaterialization(null, idToken);

      // Phase 3: Enrich show docs (logos, extra videos, cast, etc.)
      await runShowScan(null, idToken);

      // Phase 4: Enrich episode-level fields (title/description/thumbnail)
      await runEpisodeScan(idToken);

      setIsComplete(true);
    } catch (err: any) {
      console.error("Deep scan failed:", err);
      setError(err.message || "An unknown error occurred during the scan.");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Library Maintenance</CardTitle>
        <CardDescription>
          This tool performs a deep scan of your entire library to find and enrich items
          that are missing metadata from TMDB. This includes both movies and TV shows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleStartScan} disabled={isScanning}>
          {isScanning ? <RefreshCw className="animate-spin" /> : <Search />}
          {isScanning ? "Scanning..." : "Start Deep Scan"}
        </Button>

        {(isScanning || isComplete || error) && (
          <div className="p-4 border rounded-lg bg-muted/50 space-y-2">
            <h4 className="font-semibold text-sm">Scan Progress</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <p>
                Items Scanned:{" "}
                <span className="font-medium text-foreground">
                  {progress.scanned}
                </span>
              </p>
              <p>
                Enriched:{" "}
                <span className="font-medium text-green-400">
                  {progress.enriched}
                </span>
              </p>
              <p>
                Skipped:{" "}
                <span className="font-medium text-foreground">
                  {progress.skipped}
                </span>
              </p>
              <p>
                Not Found:{" "}
                <span className="font-medium text-amber-400">
                  {progress.notFound}
                </span>
              </p>
              <p>
                Errors:{" "}
                <span className="font-medium text-red-400">
                  {progress.errors}
                </span>
              </p>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Scan Failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isComplete && !error && (
          <Alert
            variant="default"
            className="bg-green-500/10 border-green-500/20 text-green-300"
          >
            <CheckCircle className="text-green-400" />
            <AlertTitle>Scan Complete</AlertTitle>
            <AlertDescription>
              The library maintenance scan has finished successfully. You may now need to
              refresh your TV library to see the changes.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
