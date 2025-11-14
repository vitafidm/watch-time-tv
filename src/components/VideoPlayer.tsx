// src/components/VideoPlayer.tsx
"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useHlsPlayback } from "@/hooks/useHlsPlayback";
import { cn } from "@/lib/utils";
import { postPlaybackReport } from "@/lib/playbackReport";

type Props = {
  mediaId: string | null;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  /** When controls are hidden, allow click-to-toggle play/pause */
  clickToToggleWhenNoControls?: boolean;
  /** Starting position in seconds (e.g., for Resume). */
  startAtSeconds?: number;
};

// ---- Reporting / resume constants ----
const REPORT_INTERVAL_MS = 12_000;   // throttle period
const FINISH_THRESHOLD = 0.95;       // 95% complete = finished (with guards below)
const RESUME_MIN_SECONDS = 10;       // ignore crumbs below 10s

// ---- Finished-robustness guards ----
const MIN_FINISHABLE_DURATION = 60;  // don't "finish" unless at least a minute long
const FINISH_SLACK_SECONDS = 8;      // or within this many seconds of the end
const DURATION_STABLE_TICKS = 2;     // how many consecutive ticks duration must be stable

export function VideoPlayer({
  mediaId,
  className,
  autoPlay = true,
  controls = true,
  muted = false,
  clickToToggleWhenNoControls = true,
  startAtSeconds,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { videoRef, status, error } = useHlsPlayback(mediaId, {
    startTime: Number.isFinite(startAtSeconds) ? Math.max(0, startAtSeconds!) : 0,
  });

  // ---- Progress reporting state ----
  const lastReportAtRef = useRef<number>(0);
  const lastSentPosRef = useRef<number>(0);
  const lastKnownDurRef = useRef<number>(0);
  const flushInFlightRef = useRef<Promise<void> | null>(null);

  // Track duration "stability" to avoid early bogus duration values
  const stableTicksRef = useRef<number>(0);
  const endedRef = useRef<boolean>(false);

  // fullscreen once per media
  const triedFsForMedia = useRef<string | null>(null);

  const tryEnterFullscreen = useCallback(async () => {
    if (!mediaId) return;
    if (triedFsForMedia.current === mediaId) return;
    triedFsForMedia.current = mediaId;

    const video = videoRef.current as any;
    const container = containerRef.current as any;

    if (video && typeof video.webkitEnterFullscreen === "function") {
      try {
        video.webkitEnterFullscreen();
        return;
      } catch { /* noop */ }
    }

    const req =
      container?.requestFullscreen ||
      container?.webkitRequestFullscreen ||
      container?.msRequestFullscreen ||
      container?.mozRequestFullScreen;

    try { if (req) await req.call(container); } catch { /* user gesture required; ignore */ }
  }, [mediaId, videoRef]);

  useEffect(() => {
    if (!mediaId) return;
    tryEnterFullscreen();
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [mediaId, tryEnterFullscreen]);

  // overlay
  const showOverlay = status === "loading" || status === "preparing";
  const overlayText = status === "preparing" ? "Preparing your video…" : "Loading…";
  const showError = status === "error";

  // click-to-toggle
  const onCanvasClick = useCallback(async () => {
    if (controls || !clickToToggleWhenNoControls) return;
    const v = videoRef.current;
    if (!v) return;
    try { if (v.paused) await v.play(); else v.pause(); } catch {}
  }, [controls, clickToToggleWhenNoControls, videoRef]);

  // ---------- PROGRESS REPORTING ----------

  function resolveDuration(v: HTMLVideoElement): number {
    // Prefer real duration; fall back to last seekable end (useful for HLS early-load)
    const d = Number.isFinite(v.duration) ? v.duration : NaN;
    if (Number.isFinite(d) && d > 0) return d;

    try {
      const ranges = v.seekable;
      if (ranges && ranges.length > 0) {
        const end = ranges.end(ranges.length - 1);
        if (Number.isFinite(end) && end > 0) return end;
      }
    } catch {}
    return lastKnownDurRef.current || 0;
  }

  const flushReport = useCallback(async (isFinal = false) => {
    if (!mediaId) return;
    const v = videoRef.current;
    if (!v) return;
  
    // Don't run the final report if the video has ended and already sent its true final report
    if (isFinal && endedRef.current) return;
  
    const now = Date.now();
    const since = now - (lastReportAtRef.current || 0);
    // Throttle regular updates, but always allow final reports
    if (!isFinal && since < REPORT_INTERVAL_MS) return;
  
    let pos = Math.max(0, Math.floor(v.currentTime || 0));
    let dur = Math.max(1, Math.floor(resolveDuration(v) || 0));
    const prevDur = lastKnownDurRef.current || 0;
  
    if (Math.abs(dur - prevDur) >= 2) {
      stableTicksRef.current = 0;
    } else {
      stableTicksRef.current += 1;
    }
  
    if (dur < prevDur) dur = prevDur;
    lastKnownDurRef.current = dur;
  
    if (!Number.isFinite(pos)) pos = 0;
    if (pos > dur) pos = dur;
  
    // Drop noisy reports for very short positions unless it's a final save
    if (pos < RESUME_MIN_SECONDS && !isFinal) {
      lastReportAtRef.current = now;
      return;
    }
  
    // Determine "finished" state conservatively
    const durationLooksStable = stableTicksRef.current >= DURATION_STABLE_TICKS;
    const longEnough = dur >= MIN_FINISHABLE_DURATION;
    const remaining = Math.max(0, dur - pos);
  
    const isPlaybackFinished =
      endedRef.current || // video element fired 'ended'
      (durationLooksStable && longEnough && pos >= Math.floor(FINISH_THRESHOLD * dur)) ||
      (durationLooksStable && longEnough && remaining <= FINISH_SLACK_SECONDS);
  
    // De-dup tiny repeats unless something significant has changed
    const positionChangedSignificantly = Math.abs(pos - lastSentPosRef.current) >= 2;
    if (!isFinal && !isPlaybackFinished && !positionChangedSignificantly) {
      lastReportAtRef.current = now;
      return;
    }
  
    lastReportAtRef.current = now;
    lastSentPosRef.current = pos;
  
    try {
      // a single promise can be awaited by multiple callers
      if (!flushInFlightRef.current) {
        flushInFlightRef.current = postPlaybackReport({
          mediaId,
          position: pos,
          duration: dur,
          finished: isPlaybackFinished,
        });
      }
      await flushInFlightRef.current;
    } catch {
      // Best-effort; don't crash the player if reporting fails
    } finally {
      flushInFlightRef.current = null;
    }
  }, [mediaId, videoRef]);
  

  // throttle on timeupdate + capture 'ended'
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mediaId) return;

    // reset guards per media attach
    endedRef.current = false;
    stableTicksRef.current = 0;
    lastKnownDurRef.current = 0;

    const onTime = () => { void flushReport(false); };
    const onPause = () => { void flushReport(true); }; // save on pause
    const onEnded = () => { endedRef.current = true; void flushReport(true); }; // save on end

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);

    const onHidden = () => { if (document.visibilityState === 'hidden') void flushReport(true); };
    document.addEventListener("visibilitychange", onHidden);

    const onBeforeUnload = async (event: BeforeUnloadEvent) => {
        if (flushInFlightRef.current) {
          event.preventDefault(); // try to block unload
          await flushInFlightRef.current;
        }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // Final report on unmount
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", onBeforeUnload);

      // Perform one last save, but only if the video hasn't naturally ended.
      if (!v.ended) {
        void flushReport(true);
      }
    };
  }, [mediaId, flushReport]);

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
