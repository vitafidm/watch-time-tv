// src/components/VideoPlayer.tsx
"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useHlsPlayback } from "@/hooks/useHlsPlayback";
import { cn } from "@/lib/utils";
import { postPlaybackReport } from "@/lib/playbackReport";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useServerConfig } from "@/hooks/useServerConfig"; 
import { useServerConnection } from "@/hooks/useServerConnection";

/* =============================================================================
 * Types
 * ========================================================================== */

type Props = {
  mediaId: string | null;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  clickToToggleWhenNoControls?: boolean;
  startAtSeconds?: number;
  fullWindow?: boolean; 
};

// Reporting constants
const REPORT_INTERVAL_MS = 12_000;
const RESUME_MIN_SECONDS = 10;
const FINISH_ONLY_ON_ENDED = true;

/* =============================================================================
 * VideoPlayer component
 * ========================================================================== */

export function VideoPlayer({
  mediaId,
  className,
  autoPlay = true,
  controls = true,
  muted = false,
  clickToToggleWhenNoControls = true,
  startAtSeconds,
  fullWindow = false, 
}: Props) {
  
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 1. Get User Identity & Server Config
  const { user } = useAuthUser();
  const { config } = useServerConfig();

  // 2. Resolve the Best Connection (Local vs Public)
  // We rename 'status' -> 'connectionStatus' to avoid conflict with the player's status.
  const { activeUrl, status: connectionStatus } = useServerConnection(
    user?.uid,
    config?.serverId,
    config?.backendUrl || ""
  );

  // 3. The "Patience" Logic
  // We do not start the playback engine until the connection is fully resolved.
  // This prevents the player from grabbing the Fallback IP and crashing on SSL errors.
  const isReadyToMount = connectionStatus === "connected" || connectionStatus === "offline";

  // 4. Core player hook
  // We pass 'null' as mediaId if we aren't ready, which keeps the hook dormant.
  const { videoRef, status, error } = useHlsPlayback(
    isReadyToMount ? mediaId : null, 
    {
      startTime: Number.isFinite(startAtSeconds) ? Math.max(0, startAtSeconds!) : 0,
      baseUrl: activeUrl 
    }
  );

  // Reporting refs
  const lastReportAtRef = useRef<number>(0);
  const lastSentPosRef = useRef<number>(0);
  const lastKnownDurRef = useRef<number>(0);
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  const endedRef = useRef<boolean>(false);

  /* ===========================================================================
   * UI state: overlay + error
   * ========================================================================== */
  // While searching for connection, show overlay
  const isSearching = connectionStatus === "searching" || connectionStatus === "idle";
  
  const showOverlay = isSearching || status === "loading" || status === "preparing";
  
  const overlayText = isSearching 
    ? "Finding your server..." 
    : (status === "preparing" ? "Preparing your video…" : "Loading…");
    
  const showError = status === "error";

  /* ===========================================================================
   * Interaction
   * ========================================================================== */
  const onCanvasClick = useCallback(async () => {
    if (controls || !clickToToggleWhenNoControls) return;
    const v = videoRef.current;
    if (!v) return;
    try { if (v.paused) await v.play(); else v.pause(); } catch {}
  }, [controls, clickToToggleWhenNoControls, videoRef]);

  /* ===========================================================================
   * Progress reporting helpers
   * ========================================================================== */
  function resolveDuration(v: HTMLVideoElement): number {
    const md = v.duration;
    if (Number.isFinite(md) && md > 0) return md;
    try {
      const r = v.seekable;
      if (r && r.length > 0) {
        const end = r.end(r.length - 1);
        if (Number.isFinite(end) && end > 0) return end;
      }
    } catch {}
    return lastKnownDurRef.current || 0;
  }

  const flushReport = useCallback(
    async (isFinal = false) => {
      if (!mediaId) return;
      const v = videoRef.current;
      if (!v) return;

      if (isFinal && endedRef.current) return;

      const now = Date.now();
      const since = now - (lastReportAtRef.current || 0);
      if (!isFinal && since < REPORT_INTERVAL_MS) return;

      let pos = Math.max(0, Math.floor(v.currentTime || 0));
      let dur = Math.max(1, Math.floor(resolveDuration(v) || 0));

      if (dur < lastKnownDurRef.current) dur = lastKnownDurRef.current;
      lastKnownDurRef.current = dur;

      if (!Number.isFinite(pos)) pos = 0;
      if (pos > dur) pos = dur;

      if (pos < RESUME_MIN_SECONDS && !isFinal) {
        lastReportAtRef.current = now;
        return;
      }

      const isPlaybackFinished = FINISH_ONLY_ON_ENDED ? endedRef.current : false;
      const movedEnough = Math.abs(pos - lastSentPosRef.current) >= 2;
      
      if (!isFinal && !isPlaybackFinished && !movedEnough) {
        lastReportAtRef.current = now;
        return;
      }

      lastReportAtRef.current = now;
      lastSentPosRef.current = pos;

      try {
        if (!flushInFlightRef.current) {
          const payload: any = {
            mediaId,
            position: pos,
            duration: dur,
            finished: isPlaybackFinished,
            dbg: {
              paused: v.paused,
              ended: v.ended,
              readyState: v.readyState,
            },
          };
          flushInFlightRef.current = postPlaybackReport(payload);
        }
        await flushInFlightRef.current;
      } catch {
        // ignore
      } finally {
        flushInFlightRef.current = null;
      }
    },
    [mediaId, videoRef]
  );

  /* ===========================================================================
   * Lifecycle Events
   * ========================================================================== */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mediaId) return;

    endedRef.current = false;
    lastKnownDurRef.current = 0;

    const onTime = () => { void flushReport(false); };
    const onPause = () => { void flushReport(true); };
    const onEnded = () => { endedRef.current = true; void flushReport(true); };

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);

    const onHidden = () => {
      if (document.visibilityState === "hidden") void flushReport(true);
    };
    document.addEventListener("visibilitychange", onHidden);

    const onBeforeUnload = async (e: BeforeUnloadEvent) => {
      if (flushInFlightRef.current) {
        e.preventDefault();
        await flushInFlightRef.current;
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (!v.ended) void flushReport(true);
    };
  }, [mediaId, flushReport, videoRef]);

  /* ===========================================================================
   * Render
   * ========================================================================== */

  return (
    <div
      ref={containerRef}
      className={cn(
        "bg-black overflow-hidden",
        fullWindow ? "fixed inset-0 z-50 h-[100dvh] w-screen" : "relative h-full w-full",
        className
      )}
      onClick={onCanvasClick}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        preload="auto"
        controlsList="nodownload noremoteplayback"
        data-status={status}
      />

      {showOverlay && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
            <div className="text-sm font-medium text-white/90 animate-pulse">{overlayText}</div>
          </div>
        </div>
      )}

      {showError && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 z-20">
          <div className="rounded-lg bg-red-900/80 px-6 py-4 text-center">
            <p className="text-red-200 text-lg font-semibold mb-1">Playback Error</p>
            <p className="text-white/90 text-sm">{String(error || "Unknown error")}</p>
          </div>
        </div>
      )}
    </div>
  );
}