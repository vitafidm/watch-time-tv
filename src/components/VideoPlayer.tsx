// src/components/VideoPlayer.tsx
"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useHlsPlayback } from "@/hooks/useHlsPlayback";
import { cn } from "@/lib/utils";
import { postPlaybackReport } from "@/lib/playbackReport";

/* =============================================================================
 * Types
 * ========================================================================== */

// Public props for the VideoPlayer component
type Props = {
  mediaId: string | null;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  clickToToggleWhenNoControls?: boolean;
  startAtSeconds?: number;
};

// Reporting constants (resume + heartbeat behavior)
const REPORT_INTERVAL_MS = 12_000;
const RESUME_MIN_SECONDS = 10;

// 🔒 Safety switch: only mark finished when the <video> actually ends.
const FINISH_ONLY_ON_ENDED = true;

/* =============================================================================
 * VideoPlayer component
 *  - Wraps the <video> tag and HLS hook
 *  - Handles fullscreen, overlay, click-to-toggle, and playback reporting
 * ========================================================================== */

export function VideoPlayer({
  mediaId,
  className,
  autoPlay = true,
  controls = true,
  muted = false,
  clickToToggleWhenNoControls = true,
  startAtSeconds,
}: Props) {
  // Container wrapper for fullscreen requests
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Core player hook: wires HLS.js + signed URL playback
  const { videoRef, status, error } = useHlsPlayback(mediaId, {
    // startTime comes from parent (e.g. "continue watching" resume point)
    startTime: Number.isFinite(startAtSeconds) ? Math.max(0, startAtSeconds!) : 0,
  });

  // Reporting state (all kept in refs so we don't trigger re-renders)
  const lastReportAtRef = useRef<number>(0); // last time we sent a report (ms)
  const lastSentPosRef = useRef<number>(0); // last position we actually reported (s)
  const lastKnownDurRef = useRef<number>(0); // best known duration (s)
  const flushInFlightRef = useRef<Promise<void> | null>(null); // current POST in-flight
  const endedRef = useRef<boolean>(false); // tracks if "ended" event has fired

  /* ===========================================================================
   * Fullscreen handling (attempt once per mediaId)
   * ========================================================================== */

  // Track which mediaId we've already tried fullscreen for (avoid spamming)
  const triedFsForMedia = useRef<string | null>(null);

  // Try to enter fullscreen (iOS webkit or standard Fullscreen APIs)
  const tryEnterFullscreen = useCallback(async () => {
    if (!mediaId) return;
    if (triedFsForMedia.current === mediaId) return;
    triedFsForMedia.current = mediaId;

    const video = videoRef.current as any;
    const container = containerRef.current as any;

    // iOS Safari path
    if (video && typeof video.webkitEnterFullscreen === "function") {
      try { video.webkitEnterFullscreen(); return; } catch {}
    }

    // Standard / vendor-prefixed fullscreen on container
    const req =
      container?.requestFullscreen ||
      container?.webkitRequestFullscreen ||
      container?.msRequestFullscreen ||
      container?.mozRequestFullScreen;
    try { if (req) await req.call(container); } catch {}
  }, [mediaId, videoRef]);

  // On mediaId change: attempt fullscreen once, and clean up fullscreen on unmount
  useEffect(() => {
    if (!mediaId) return;
    tryEnterFullscreen();
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [mediaId, tryEnterFullscreen]);

  /* ===========================================================================
   * UI state: overlay + error
   * ========================================================================== */

  // Loading/preparing overlay states
  const showOverlay = status === "loading" || status === "preparing";
  const overlayText = status === "preparing" ? "Preparing your video…" : "Loading…";

  // Error banner flag
  const showError = status === "error";

  /* ===========================================================================
   * Interaction: click-to-toggle when controls are hidden
   * ========================================================================== */

  const onCanvasClick = useCallback(async () => {
    // Only enable click-to-toggle when controls are *not* visible
    if (controls || !clickToToggleWhenNoControls) return;
    const v = videoRef.current;
    if (!v) return;
    try { if (v.paused) await v.play(); else v.pause(); } catch {}
  }, [controls, clickToToggleWhenNoControls, videoRef]);

  /* ===========================================================================
   * Progress reporting helpers
   * ========================================================================== */

  // Best-effort duration resolver:
  //  1) metadata duration
  //  2) seekable range end
  //  3) last known good duration
  function resolveDuration(v: HTMLVideoElement): number {
    // Prefer true metadata duration; fall back to seekable end; cache last good
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

  // Throttled progress reporter (for resume + "finished" signals)
  const flushReport = useCallback(
    async (isFinal = false) => {
      if (!mediaId) return;
      const v = videoRef.current;
      if (!v) return;

      // If we already processed 'ended' and this is another final call, skip
      if (isFinal && endedRef.current) return;

      const now = Date.now();
      const since = now - (lastReportAtRef.current || 0);
      // Non-final reports are throttled by REPORT_INTERVAL_MS
      if (!isFinal && since < REPORT_INTERVAL_MS) return;

      let pos = Math.max(0, Math.floor(v.currentTime || 0));
      let dur = Math.max(1, Math.floor(resolveDuration(v) || 0));

      // Keep the largest seen duration to avoid backward jumps
      if (dur < lastKnownDurRef.current) dur = lastKnownDurRef.current;
      lastKnownDurRef.current = dur;

      if (!Number.isFinite(pos)) pos = 0;
      if (pos > dur) pos = dur;

      // Ignore short "crumbs" unless this is a final save (no resume < RESUME_MIN_SECONDS)
      if (pos < RESUME_MIN_SECONDS && !isFinal) {
        lastReportAtRef.current = now;
        return;
      }

      // 🚫 Hard guard: only treat as finished when 'ended' actually fired.
      const isPlaybackFinished = FINISH_ONLY_ON_ENDED ? endedRef.current : false;

      // De-dupe tiny repeats when not finishing
      const movedEnough = Math.abs(pos - lastSentPosRef.current) >= 2;
      if (!isFinal && !isPlaybackFinished && !movedEnough) {
        lastReportAtRef.current = now;
        return;
      }

      lastReportAtRef.current = now;
      lastSentPosRef.current = pos;

      try {
        if (!flushInFlightRef.current) {
          // Include light debug context (harmless extras for your backend)
          const payload: any = {
            mediaId,
            position: pos,
            duration: dur,
            finished: isPlaybackFinished,
            // debug-only fields:
            dbg: {
              paused: v.paused,
              ended: v.ended,
              readyState: v.readyState,
              bufferedEnd:
                (() => {
                  try {
                    const b = v.buffered;
                    return b && b.length ? Math.floor(b.end(b.length - 1)) : 0;
                  } catch { return 0; }
                })(),
            },
          };
          flushInFlightRef.current = postPlaybackReport(payload);
        }
        await flushInFlightRef.current;
      } catch {
        // best-effort (swallow network errors)
      } finally {
        flushInFlightRef.current = null;
      }
    },
    [mediaId, videoRef]
  );

  /* ===========================================================================
   * Event wiring: video + document lifecycle
   *  - timeupdate: periodic progress pings
   *  - pause / ended: final-ish reports
   *  - visibilitychange / beforeunload: "best-effort" flushes
   * ========================================================================== */

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mediaId) return;

    // Reset tracking for new media
    endedRef.current = false;
    lastKnownDurRef.current = 0;

    // Regular heartbeat while playing
    const onTime = () => { void flushReport(false); };

    // On pause, treat as a final-ish save (capture resume point)
    const onPause = () => { void flushReport(true); };

    // On natural end, mark finished + flush one last time
    const onEnded = () => { endedRef.current = true; void flushReport(true); };

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);

    // Browser/tab visibility change → flush final progress when hidden
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flushReport(true);
    };
    document.addEventListener("visibilitychange", onHidden);

    // Before page unload, try to finish any in-flight request
    const onBeforeUnload = async (e: BeforeUnloadEvent) => {
      if (flushInFlightRef.current) {
        e.preventDefault();
        await flushInFlightRef.current;
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // Cleanup handlers on unmount or media change
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", onBeforeUnload);

      // Last best-effort flush if the video did not naturally end
      if (!v.ended) void flushReport(true);
    };
  }, [mediaId, flushReport, videoRef]);

  /* ===========================================================================
   * Render: container, <video>, overlay + error banner
   * ========================================================================== */

  return (
    <div
      ref={containerRef}
      className={cn("relative bg-black", className)}
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
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <div className="text-sm text-white/80">{overlayText}</div>
          </div>
        </div>
      )}

      {showError && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-red-600/90 px-3 py-1 text-sm text-white">
          {String(error || "Playback error")}
        </div>
      )}
    </div>
  );
}
