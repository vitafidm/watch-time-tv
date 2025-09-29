
"use client";

import { useState } from 'react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { callFunction } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Search, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';

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

    try {
      const idToken = await user.getIdToken();
      
      const runScan = async (currentCursor: string | null, token: string): Promise<void> => {
        const body = { 
          uid: user.uid, 
          processAll: true,
          cursor: currentCursor 
        };
        const response: any = await callFunction('tmdbBackfillMissing', body, token);

        setProgress(prev => ({
          scanned: prev.scanned + (response.scanned || 0),
          enriched: prev.enriched + (response.enriched || 0),
          notFound: prev.notFound + (response.notFound || 0),
          errors: prev.errors + (response.errors || 0),
          skipped: prev.skipped + (response.skipped || 0),
        }));

        if (response.nextCursor) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          return runScan(response.nextCursor, token);
        }
      };

      await runScan(null, idToken);
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
          that are missing metadata from TMDB. This is useful for fixing incorrect show groupings
          or missing movie posters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleStartScan} disabled={isScanning}>
          {isScanning ? (
            <RefreshCw className="animate-spin" />
          ) : (
            <Search />
          )}
          {isScanning ? 'Scanning...' : 'Start Deep Scan'}
        </Button>

        {(isScanning || isComplete || error) && (
          <div className="p-4 border rounded-lg bg-muted/50 space-y-2">
            <h4 className="font-semibold text-sm">Scan Progress</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <p>Items Scanned: <span className="font-medium text-foreground">{progress.scanned}</span></p>
              <p>Enriched: <span className="font-medium text-green-400">{progress.enriched}</span></p>
              <p>Skipped: <span className="font-medium text-foreground">{progress.skipped}</span></p>
              <p>Not Found: <span className="font-medium text-amber-400">{progress.notFound}</span></p>
              <p>Errors: <span className="font-medium text-red-400">{progress.errors}</span></p>
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
            <Alert variant="default" className="bg-green-500/10 border-green-500/20 text-green-300">
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
