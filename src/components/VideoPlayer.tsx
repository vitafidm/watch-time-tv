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
  clickToToggleWhenNoControls?: boolean;
  startAtSeconds?: number;
};

// Reporting constants
const REPORT_INTERVAL_MS = 12_000;
const RESUME_MIN_SECONDS = 10;

// 🔒 Safety switch: only mark finished when the <video> actually ends.
const FINISH_ONLY_ON_ENDED = true;

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

  const lastReportAtRef = useRef<number>(0);
  const lastSentPosRef = useRef<number>(0);
  const lastKnownDurRef = useRef<number>(0);
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  const endedRef = useRef<boolean>(false);

  // Fullscreen once per media
  const triedFsForMedia = useRef<string | null>(null);
  const tryEnterFullscreen = useCallback(async () => {
    if (!mediaId) return;
    if (triedFsForMedia.current === mediaId) return;
    triedFsForMedia.current = mediaId;

    const video = videoRef.current as any;
    const container = containerRef.current as any;

    if (video && typeof video.webkitEnterFullscreen === "function") {
      try { video.webkitEnterFullscreen(); return; } catch {}
    }
    const req =
      container?.requestFullscreen ||
      container?.webkitRequestFullscreen ||
      container?.msRequestFullscreen ||
      container?.mozRequestFullScreen;
    try { if (req) await req.call(container); } catch {}
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

  // Overlay
  const showOverlay = status === "loading" || status === "preparing";
  const overlayText = status === "preparing" ? "Preparing your video…" : "Loading…";
  const showError = status === "error";

  // Click-to-toggle when no controls
  const onCanvasClick = useCallback(async () => {
    if (controls || !clickToToggleWhenNoControls) return;
    const v = videoRef.current;
    if (!v) return;
    try { if (v.paused) await v.play(); else v.pause(); } catch {}
  }, [controls, clickToToggleWhenNoControls, videoRef]);

  // ---- Progress reporting ----
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

  
  const flushReport = useCallback(
    async (isFinal = false) => {
      if (!mediaId) return;
      const v = videoRef.current;
      if (!v) return;

      // If we already processed 'ended' and this is another final call, skip
      if (isFinal && endedRef.current) return;

      const now = Date.now();
      const since = now - (lastReportAtRef.current || 0);
      if (!isFinal && since < REPORT_INTERVAL_MS) return;

      let pos = Math.max(0, Math.floor(v.currentTime || 0));
      let dur = Math.max(1, Math.floor(resolveDuration(v) || 0));

      // keep the largest seen duration to avoid backward jumps
      if (dur < lastKnownDurRef.current) dur = lastKnownDurRef.current;
      lastKnownDurRef.current = dur;

      if (!Number.isFinite(pos)) pos = 0;
      if (pos > dur) pos = dur;

      // ignore crumbs unless it's a final save
      if (pos < RESUME_MIN_SECONDS && !isFinal) {
        lastReportAtRef.current = now;
        return;
      }

      // 🚫 Hard guard: only treat as finished when 'ended' actually fired.
      const isPlaybackFinished = FINISH_ONLY_ON_ENDED ? endedRef.current : false;

      // de-dupe tiny repeats when not finishing
      const movedEnough = Math.abs(pos - lastSentPosRef.current) >= 2;
      if (!isFinal && !isPlaybackFinished && !movedEnough) {
        lastReportAtRef.current = now;
        return;
      }

      lastReportAtRef.current = now;
      lastSentPosRef.current = pos;

      try {
        if (!flushInFlightRef.current) {
          // include light debug context (harmless extras for your backend)
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
        // best-effort
      } finally {
        flushInFlightRef.current = null;
      }
    },
    [mediaId, videoRef]
  );



  // Wire up listeners
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
