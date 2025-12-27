// src/hooks/useHlsPlayback.ts
import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { getPlaybackUrl } from "@/lib/startPlayback";
import { useAuthUser } from "@/hooks/useAuthUser";

export type PlaybackStatus = "idle" | "loading" | "preparing" | "retrying" | "ready" | "error";

function asAbsolute(urlStr: string) {
  return new URL(
    urlStr,
    typeof window !== "undefined" ? window.location.origin : "http://localhost"
  );
}

// ✅ True Safari detector
function isTrueSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const vendor = (navigator as any).vendor || "";
  const isSafariUA = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Brave/.test(ua);
  const isAppleVendor = /Apple/.test(vendor);
  return isSafariUA && isAppleVendor;
}

const STATUS_POLL_MS = 1500;
const STATUS_POLL_MAX_MS = 90_000;
const START_TIMEOUT_MS = 30_000;
const NO_FRAG_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [3000, 5000, 8000, 10000];
const MAX_RETRY_ATTEMPTS = 20;
const NO_PROGRESS_MS = 6_000;

export function useHlsPlayback(
  mediaId: string | null,
  opts?: { startTime?: number; baseUrl?: string }
) {
  // 1. Get Auth State
  const { user, loading: authLoading } = useAuthUser();

  // 2. Debug Log (Keep this for one more run to be sure)
  console.log("[DEBUG CHECK]", {
    mediaId,            
    authLoading,        
    user: !!user,       
    baseUrl: opts?.baseUrl 
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const attachInFlight = useRef(false);
  const cancelledRef = useRef(false);

  // Timers and state refs
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fragTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRetryDoneRef = useRef(false);
  const retryCountRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const startTargetRef = useRef<number>(0);
  const startSettledRef = useRef<boolean>(false);
  const lastTokenRef = useRef<string | null>(null);
  const lastTimeupdateRef = useRef<number>(0);
  const noProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raw = opts?.startTime;
    const st = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (st !== startTargetRef.current) {
      startTargetRef.current = st;
      if (st > 0) {
        resumeAppliedRef.current = false;
        startSettledRef.current = false;
      }
    }
  }, [opts?.startTime]);

  function log(...args: any[]) {
    console.log("[playback]", ...args);
  }

  function clearTimers() {
    if (startTimerRef.current) { clearTimeout(startTimerRef.current); startTimerRef.current = null; }
    if (fragTimerRef.current)  { clearTimeout(fragTimerRef.current);  fragTimerRef.current  = null; }
    if (noProgressTimerRef.current) { clearTimeout(noProgressTimerRef.current); noProgressTimerRef.current = null; }
  }

  function armStartWatchdog(onTimeout: () => void) {
    if (startTimerRef.current) clearTimeout(startTimerRef.current);
    startTimerRef.current = setTimeout(onTimeout, START_TIMEOUT_MS);
  }

  function armFragWatchdog(onTimeout: () => void) {
    if (fragTimerRef.current) clearTimeout(fragTimerRef.current);
    fragTimerRef.current = setTimeout(onTimeout, NO_FRAG_TIMEOUT_MS);
  }

  function armNoProgressWatchdog(video: HTMLVideoElement) {
    if (noProgressTimerRef.current) clearTimeout(noProgressTimerRef.current);
    noProgressTimerRef.current = setTimeout(async () => {
      if (!video || video.paused) { 
        armNoProgressWatchdog(video); 
        return;
      }
      const now = Date.now();
      const last = lastTimeupdateRef.current || 0;
      if (now - last >= NO_PROGRESS_MS) {
        log("no progress; micro-seek + restart loader");
        try {
          const ct = video.currentTime;
          video.currentTime = Math.max(0, ct + 0.001);
          await video.play().catch(() => {});
          const hls = hlsRef.current;
          if (hls) {
            try { hls.stopLoad(); } catch {}
            setTimeout(() => { try { hls.startLoad(); } catch {} }, 120);
          }
        } catch {}
      }
      armNoProgressWatchdog(video);
    }, NO_PROGRESS_MS);
  }

  function applyStartTimeOnce(video: HTMLVideoElement) {
    if (resumeAppliedRef.current) return;
    const st = startTargetRef.current;
    if (!Number.isFinite(st) || st <= 0) return;
    try {
      video.currentTime = Math.max(0, st - 0.01);
      startSettledRef.current = false;
      resumeAppliedRef.current = true;
    } catch {}
  }

  function reassertStartIfDrift(video: HTMLVideoElement) {
    if (startSettledRef.current) return;   
    const st = startTargetRef.current ?? 0;
    if (!Number.isFinite(st) || st <= 0) return;
    const drift = Math.abs(video.currentTime - st);
    if (drift > 2 && !video.seeking) {
      try { video.currentTime = Math.max(0, st - 0.01); } catch {}
    }
  }

  function buildPlaylistUrl(base: string): string {
    const u = asAbsolute(base);
    const tokenOnUrl = u.searchParams.get("token");
    if (!tokenOnUrl && lastTokenRef.current) {
      u.searchParams.set("token", lastTokenRef.current);
    }
    u.searchParams.set("forceToken", "1");
    return u.toString();
  }

  const fetchUrl = useCallback(async () => {
    if (authLoading) return null;
    if (!user) throw new Error("Not signed in");
    if (!mediaId) throw new Error("Missing mediaId");

    console.log("[STEP 1] Getting ID Token...");
    const idToken = await user.getIdToken(true);
    console.log("[STEP 2] Got ID Token. Calling Cloud Function...");
    
    // 1. Get the standard signed URL from backend
    const { url: originalSignedUrl, expiresAt } = await getPlaybackUrl(mediaId, idToken);
    
    console.log("[STEP 3] Cloud Function Returned:", originalSignedUrl);

    let finalUrl = originalSignedUrl;

    // 2. FORCE the use of the Discovery Winner (baseUrl) if available
    if (opts?.baseUrl) {
      try {
        console.log(`[STEP 4] Swapping Base URL to: ${opts.baseUrl}`);
        const source = new URL(originalSignedUrl, "http://dummy");
        const target = new URL(opts.baseUrl);

        target.pathname = source.pathname;
        target.search = source.search;
        
        finalUrl = target.toString();
        console.log(`[STEP 5] Final Swapped URL: ${finalUrl}`);
      } catch (e) {
        console.warn("[playback] Failed to swap base URL:", e);
      }
    }

    const u = asAbsolute(finalUrl);
    const t = u.searchParams.get("token");
    if (t) lastTokenRef.current = t;

    setCurrentUrl(finalUrl);
    setExpiresAt(expiresAt);
    return { url: finalUrl, expiresAt };
  }, [user, mediaId, authLoading, opts?.baseUrl]);

  // Session Cookie Priming
  const primeSessionCookie = useCallback(
    async (targetOrigin: string) => {
      if (!user) return;
      try {
        const idToken = await user.getIdToken(true);
        await fetch(`${targetOrigin}/session`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        log("primed session cookie");
      } catch {
        log("prime cookie failed (non-fatal)");
      }
    },
    [user]
  );

  const waitForReady = useCallback(
    async (signedUrl: string): Promise<string | null> => {
      const u = asAbsolute(signedUrl);
      const nasOrigin = `${u.protocol}//${u.host}`;
      const token = u.searchParams.get("token") || "";
      if (token) lastTokenRef.current = token;

      await primeSessionCookie(nasOrigin);

      const statusUrl = `${nasOrigin}/hls/${encodeURIComponent(mediaId!)}/status${token ? `?token=${encodeURIComponent(token)}` : ""}`;

      setStatus("preparing");
      log("waiting for READY…");

      const t0 = Date.now();
      while (!cancelledRef.current && Date.now() - t0 < STATUS_POLL_MAX_MS) {
        try {
          const r = await fetch(statusUrl, { method: "GET", credentials: "include" });
          if (cancelledRef.current) break;
          if (r.status === 401 || r.status === 403) throw new Error("auth");

          if (r.ok) {
            const j = (await r.json().catch(() => ({}))) as { status?: string; url?: string };
            if (j?.status === "ready") {
              const readyAbs = j.url ? new URL(j.url, nasOrigin).toString() : u.toString();
              return readyAbs;
            }
          }
        } catch {}
        await new Promise((r) => setTimeout(r, STATUS_POLL_MS));
      }
      return null;
    },
    [mediaId, primeSessionCookie]
  );

  const warmupOnce = async (nasOrigin: string, mid: string, token?: string) => {
      let r = await fetch(`${nasOrigin}/hls/${encodeURIComponent(mid)}/warmup`, {
        method: "POST",
        credentials: "include",
      });
      if (r.status === 401 && token) {
        r = await fetch(
          `${nasOrigin}/hls/${encodeURIComponent(mid)}/warmup?token=${encodeURIComponent(token)}`,
          { method: "POST", credentials: "include" }
        );
      }
      const ok = r.ok;
      const txt = ok ? "" : await r.text().catch(() => "");
      const expired = r.status === 401 && /jwt expired|Unauthorized/i.test(txt);
      return { ok, expired };
  };

  const attachWithHlsJs = useCallback(async (video: HTMLVideoElement, sourceUrl: string) => {
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
      maxBufferLength: 120,
      startPosition: -1,
      liveSyncDuration: Infinity,
      driftCompensation: false,
    });

    hls.config.xhrSetup = (xhr) => { try { xhr.withCredentials = true; } catch {} };
    // @ts-ignore
    hls.config.fetchSetup = (_ctx: any, init: RequestInit) => ({ ...init, credentials: "include" });

    hlsRef.current = hls;

    const nudge = async (why: string) => {
      if (video.paused) return;
      try {
        video.currentTime = Math.max(0, video.currentTime + 0.001);
        await video.play().catch(() => {});
        try { hls.stopLoad(); } catch {}
        setTimeout(() => { try { hls.startLoad(); } catch {} }, 120);
      } catch {}
    };

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      console.log("[STEP 8] HLS Attached. Loading Source...");
      hls.loadSource(sourceUrl);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, async (_e, d) => {
      console.log("[STEP 9] Manifest Parsed. Playing...");
      if (video.readyState >= 1) {
        applyStartTimeOnce(video);
      } else {
        await new Promise<void>((resolve) => {
          const onMeta = () => { video.removeEventListener("loadedmetadata", onMeta); applyStartTimeOnce(video); resolve(); };
          video.addEventListener("loadedmetadata", onMeta);
        });
      }
      reassertStartIfDrift(video);
      armNoProgressWatchdog(video);
      await video.play().catch(() => {});
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
      clearTimeout(startTimerRef.current as any);
      if (!cancelledRef.current) setStatus("ready");
      if (d?.details?.live) reassertStartIfDrift(video);
    });

    hls.on(Hls.Events.FRAG_LOADED, (_e, d) => {
      clearTimeout(startTimerRef.current as any);
      clearTimeout(fragTimerRef.current as any);
      armFragWatchdog(() => nudge("no fragments for a while"));
      armNoProgressWatchdog(video);
    });

    hls.on(Hls.Events.ERROR, async (_evt, data) => {
      console.warn("[HLS ERROR]", data.type, data.details);
      if (video.paused) return;
      if (!data?.fatal) {
         return;
      }
      if (data?.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); return; } catch {}
      }
      if (data?.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); return; } catch {}
      }
      if (!cancelledRef.current) {
        setError("Playback error");
        setStatus("error");
      }
      try { hls.destroy(); } catch {}
      hlsRef.current = null;
    });

    hls.attachMedia(video);
    await video.play().catch(() => {});
  }, [fetchUrl]);

  const attach = useCallback(async () => {
    if (!videoRef.current || !mediaId) return;
    if (authLoading || !user) return;
    if (attachInFlight.current) return;

    attachInFlight.current = true;
    setError(null);
    if (status !== "loading") setStatus("loading");
    startRetryDoneRef.current = false;
    clearTimers();

    console.log("[STEP 0] Starting Attach...");

    try {
      const first = await fetchUrl();
      if (!first) {
         console.error("[STEP X] FetchUrl returned null!");
         return;
      }
      let signedUrl = first.url;

      const u0 = asAbsolute(signedUrl);
      const nasOrigin0 = `${u0.protocol}//${u0.host}`;
      const tok0 = u0.searchParams.get("token") || "";
      if (tok0) lastTokenRef.current = tok0;

      console.log(`[STEP 6] Warming up NAS at ${nasOrigin0}...`);
      let w = await warmupOnce(nasOrigin0, mediaId, tok0);
      if (!w.ok && w.expired) {
        const fresh = await fetchUrl();
        if (fresh) {
          signedUrl = fresh.url;
          const uf = asAbsolute(fresh.url);
          const t = uf.searchParams.get("token") || "";
          if (t) lastTokenRef.current = t;
          await warmupOnce(`${uf.protocol}//${uf.host}`, mediaId, t);
        }
      }

      console.log("[STEP 7] Waiting for HLS Status=Ready...");
      let playlistUrl: string | null;
      try {
        playlistUrl = await waitForReady(signedUrl);
      } catch (e: any) {
        if (e?.message === "auth") {
          const fresh = await fetchUrl();
          if (!fresh) throw new Error("auth-resolve");
          playlistUrl = await waitForReady(fresh.url);
        } else {
          throw e;
        }
      }

      if (!playlistUrl) {
        if (!cancelledRef.current) {
          setError(null);
          setStatus("retrying");
        }
        return;
      }
      if (cancelledRef.current) return;

      if (Hls.isSupported()) {
        await attachWithHlsJs(videoRef.current!, buildPlaylistUrl(playlistUrl));
        return;
      }

      setError("HLS not supported in this browser.");
      setStatus("error");
    } catch (e: any) {
      const msg = e?.message || "Failed to start playback";
      log("attach error", msg);
      if (!/Not signed in/i.test(msg)) setError(msg);
      setStatus(/Not signed in/i.test(msg) ? "idle" : "error");
    } finally {
      attachInFlight.current = false;
    }
  }, [
    mediaId,
    authLoading,
    user,
    fetchUrl,
    waitForReady,
    status,
    attachWithHlsJs,
    opts?.startTime,
  ]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!mediaId) return;
    if (authLoading) return;
    if (!user) {
      setStatus("idle");
      setError("Not signed in");
      return;
    }
    setStatus("loading");
    return () => {
      cancelledRef.current = true;
      clearTimers();
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
      if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.removeAttribute("src"); videoRef.current.load(); } catch {} }
      attachInFlight.current = false;
    };
  }, [mediaId, authLoading, user, opts?.baseUrl]);

  // --- THE CRITICAL FIX IS HERE ---
  useEffect(() => {
    if (status !== "loading") return;
    if (!mediaId || authLoading || !user) return;
    if (attachInFlight.current) return;
    attach().catch((e) => {
      setError(e?.message || "Failed to start playback");
      setStatus("error");
    });
  // We add opts?.baseUrl so it retries even if 'status' is already loading
  }, [status, mediaId, user, opts?.baseUrl]); 

  useEffect(() => {
    if (status !== "retrying") return;
    const attempt = (retryCountRef.current || 0) + 1;
    retryCountRef.current = attempt;
    if (attempt > MAX_RETRY_ATTEMPTS) {
      setError("Still preparing the stream. Please try again in a moment.");
      setStatus("error");
      return;
    }
    const idx = Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1);
    const delay = RETRY_DELAYS_MS[idx];
    const t = setTimeout(() => {
      if (!cancelledRef.current) setStatus("loading");
    }, delay);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (status === "ready") retryCountRef.current = 0;
  }, [status]);

  useEffect(() => {
    if (!expiresAt) return;
    const now = Math.floor(Date.now() / 1000);
    const refreshInMs = Math.max(1, (expiresAt - now) - 30) * 1000;

    const t = setTimeout(async () => {
      try {
        const fresh = await fetchUrl();
        if (!fresh) return;
        const v = videoRef.current;
        if (!v) return;

        const refreshed = buildPlaylistUrl(fresh.url);

        if (isTrueSafari() && v.canPlayType("application/vnd.apple.mpegurl")) {
          const wasPaused = v.paused;
          const prevCT = Number.isFinite(v.currentTime) ? v.currentTime : 0;
          v.src = refreshed;
          await new Promise<void>((resolve) => {
            if (v.readyState >= 1) { resolve(); return; }
            const onMeta = () => { v.removeEventListener("loadedmetadata", onMeta); resolve(); };
            v.addEventListener("loadedmetadata", onMeta);
          });
          try { if (prevCT > 0) v.currentTime = prevCT; } catch {}
          if (!wasPaused) await v.play().catch(() => {});
        } else if (hlsRef.current) {
          const prevCT = Number.isFinite(v.currentTime) ? v.currentTime : 0;
          hlsRef.current.loadSource(refreshed);
          hlsRef.current.once(Hls.Events.MANIFEST_PARSED, async () => {
            try { if (prevCT > 0) v.currentTime = prevCT; } catch {}
            await v.play().catch(() => {});
          });
          hlsRef.current.attachMedia(v);
        }
      } catch (e) {
        console.warn("[playback] token refresh failed:", e);
      }
    }, refreshInMs);

    return () => clearTimeout(t);
  }, [expiresAt, fetchUrl]);

  return { videoRef, status, error, currentUrl, refresh: attach };
}