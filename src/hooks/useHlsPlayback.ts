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

// ✅ True Safari detector (prevents Chrome/Edge/Brave from taking the native path)
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

// Watchdogs
const START_TIMEOUT_MS = 30_000;
const NO_FRAG_TIMEOUT_MS = 20_000;

// Retry/backoff
const RETRY_DELAYS_MS = [3000, 5000, 8000, 10000];
const MAX_RETRY_ATTEMPTS = 20;

// Extra stall watchdogs
const NO_PROGRESS_MS = 6_000; // no timeupdate progress → micro-seek and play

export function useHlsPlayback(
  mediaId: string | null,
  opts?: { startTime?: number }
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const { user, loading: authLoading } = useAuthUser();

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const attachInFlight = useRef(false);
  const cancelledRef = useRef(false);

  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fragTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRetryDoneRef = useRef(false);
  const retryCountRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const startTargetRef = useRef<number>(0);
  const startSettledRef = useRef<boolean>(false);

  // Keep the desired resume time in a ref so all callbacks see the latest value
  useEffect(() => {
    const raw = opts?.startTime;
    const st =
      typeof raw === "number" && Number.isFinite(raw) && raw > 0
        ? raw
        : 0;

    if (st !== startTargetRef.current) {
      startTargetRef.current = st;

      if (st > 0) {
        // New resume target → allow resume to be applied again
        resumeAppliedRef.current = false;
        startSettledRef.current = false;
      }
    }
  }, [opts?.startTime]);

  // Token bookkeeping
  const lastTokenRef = useRef<string | null>(null);

  // “no playback progress” watchdog
  const lastTimeupdateRef = useRef<number>(0);
  const noProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function log(...args: any[]) {
    // flip to console.debug if you want quieter logs
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
      if (!video || video.paused) { // ✅ DO NOT run if paused
        armNoProgressWatchdog(video); // just re-arm
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
      // Seek just before the target to avoid keyframe/PTS edge issues
      video.currentTime = Math.max(0, st - 0.01);

      startSettledRef.current = false;
      resumeAppliedRef.current = true;
    } catch {
      // If this fails, our timeupdate-based logic will still update settled state
    }
  }

  function reassertStartIfDrift(video: HTMLVideoElement) {
    if (startSettledRef.current) return;   // ⬅️ stop once settled

    const st = startTargetRef.current ?? 0;
    if (!Number.isFinite(st) || st <= 0) return;

    const drift = Math.abs(video.currentTime - st);
    // only reassert during the initial attach window (<= ~2s away)
    if (drift > 2 && !video.seeking) {
      try {
        video.currentTime = Math.max(0, st - 0.01);
      } catch {}
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

    const idToken = await user.getIdToken(true);
    const { url, expiresAt } = await getPlaybackUrl(mediaId, idToken);
    const u = asAbsolute(url);
    const t = u.searchParams.get("token");
    if (t) lastTokenRef.current = t;

    setCurrentUrl(url);
    setExpiresAt(expiresAt);
    log("fetched signed URL", { expiresAt, hasToken: !!t });
    return { url, expiresAt };
  }, [user, mediaId, authLoading]);

  const primeSessionCookie = useCallback(
    async (nasOrigin: string) => {
      if (!user) return;
      try {
        const idToken = await user.getIdToken(true);
        await fetch(`${nasOrigin}/pc-hls/session`, {
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

  // Progressive attempt: **only** used when starting from 0 (no resume)
  const tryProgressiveAttach = useCallback(
    async (signedUrl: string): Promise<boolean> => {
      if (!mediaId || !videoRef.current) return false;

      const u = asAbsolute(signedUrl);
      const nasOrigin = `${u.protocol}//${u.host}`;
      const token = u.searchParams.get("token") || "";
      if (token) lastTokenRef.current = token;

      await primeSessionCookie(nasOrigin);

      async function probeOnce(origin: string, tok?: string) {
        let r = await fetch(`${origin}/progress/${encodeURIComponent(mediaId)}/check`, {
          method: "GET",
          credentials: "include",
        });
        if (r.status === 401 && tok) {
          r = await fetch(
            `${origin}/progress/${encodeURIComponent(mediaId)}/check?token=${encodeURIComponent(tok)}`,
            { method: "GET", credentials: "include" }
          );
        }
        return r;
      }

      let resp = await probeOnce(nasOrigin, token);
      if (resp.status === 401) {
        const fresh = await fetchUrl();
        if (!fresh) return false;
        const uf = asAbsolute(fresh.url);
        const newTok = uf.searchParams.get("token") || "";
        if (newTok) lastTokenRef.current = newTok;

        await primeSessionCookie(`${uf.protocol}//${uf.host}`);
        resp = await probeOnce(`${uf.protocol}//${uf.host}`, newTok);
        if (!resp.ok) return false;
        signedUrl = fresh.url;
      }

      if (!resp.ok) return false;
      const check = (await resp.json().catch(() => null)) as {
        ok?: boolean;
        canProgressive?: boolean;
      } | null;
      if (!check?.ok || !check?.canProgressive) return false;

      const u2 = asAbsolute(signedUrl);
      const mp4Url =
        `${u2.protocol}//${u2.host}/progress/${encodeURIComponent(mediaId)}.mp4` +
        (u2.search ? u2.search : "");

      const video = videoRef.current!;
      try {
        log("progressive attach start");
        video.src = mp4Url;
        (video as any).playsInline = true;

        // Wait for metadata (no resume here; start from 0)
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1 /* HAVE_METADATA */) {
            resolve();
            return;
          }
          const onMeta = () => {
            video.removeEventListener("loadedmetadata", onMeta);
            resolve();
          };
          video.addEventListener("loadedmetadata", onMeta);
        });

        // Feed the no-progress watchdog
        video.addEventListener("timeupdate", () => {
          lastTimeupdateRef.current = Date.now();
        });

        armNoProgressWatchdog(video);
        await video.play().catch(() => {});
        if (!cancelledRef.current) {
          clearTimers();
          setStatus("ready");
        }
        log("progressive attach ok");
        return true;
      } catch {
        log("progressive attach failed");
        return false;
      }
    },
    [mediaId, primeSessionCookie, fetchUrl]
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
              log("status READY, playlist:", readyAbs);
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

  async function warmupOnce(nasOrigin: string, mid: string, token?: string) {
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
    log("warmup:", ok ? "ok" : `fail ${r.status}`);
    return { ok, expired };
  }

  // 🔧 Factor hls.js attach so we can call it as a fallback from native
  const attachWithHlsJs = useCallback(async (video: HTMLVideoElement, sourceUrl: string) => {
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 60,
      maxBufferLength: 60,
      startPosition: -1,
      liveSyncDuration: 10,
      liveMaxLatencyDuration: 30,
    });

    // Credentials for signed cookies/tokens
    hls.config.xhrSetup = (xhr) => { try { xhr.withCredentials = true; } catch {} };
    // @ts-ignore
    hls.config.fetchSetup = (_ctx: any, init: RequestInit) => ({ ...init, credentials: "include" });

    hlsRef.current = hls;

    const nudge = async (why: string) => {
      log("nudge:", why);
      if (video.paused) return; // ✅ DO NOT nudge if paused
      try {
        video.currentTime = Math.max(0, video.currentTime + 0.001);
        await video.play().catch(() => {});
        try { hls.stopLoad(); } catch {}
        setTimeout(() => { try { hls.startLoad(); } catch {} }, 120);
      } catch {}
    };

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      log("HLS MEDIA_ATTACHED");
      hls.loadSource(sourceUrl);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, async (_e, d) => {
      log("HLS MANIFEST_PARSED", { levels: d?.levels?.length });
      // Ensure metadata then seek once
      if (video.readyState >= 1 /* HAVE_METADATA */) {
        applyStartTimeOnce(video);
      } else {
        await new Promise<void>((resolve) => {
          const onMeta = () => {
            video.removeEventListener("loadedmetadata", onMeta);
            applyStartTimeOnce(video);
            resolve();
          };
          video.addEventListener("loadedmetadata", onMeta);
        });
      }
      reassertStartIfDrift(video);
      armNoProgressWatchdog(video);
      await video.play().catch(() => {});
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
      log("HLS LEVEL_LOADED", { targetduration: d?.details?.targetduration, live: d?.details?.live });
      clearTimeout(startTimerRef.current as any);
      if (!cancelledRef.current) setStatus("ready");
      if (d?.details?.live) {
        reassertStartIfDrift(video);
      }
    });

    hls.on(Hls.Events.FRAG_LOADED, (_e, d) => {
      log("HLS FRAG_LOADED", { sn: d?.frag?.sn });
      clearTimeout(startTimerRef.current as any);
      clearTimeout(fragTimerRef.current as any);
      armFragWatchdog(() => nudge("no fragments for a while"));
      armNoProgressWatchdog(video);
    });

    hls.on(Hls.Events.ERROR, async (_evt, data) => {
      log("HLS ERROR", data?.type, data?.details, data);
      if (video.paused) return; // ✅ DO NOT react to errors if paused
      if (!data?.fatal) {
        switch (data?.details) {
          case Hls.ErrorDetails.BUFFER_STALLED_ERROR:
          case Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE:
          case Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL:
          case Hls.ErrorDetails.FRAG_LOAD_ERROR:
          case Hls.ErrorDetails.FRAG_PARSING_ERROR:
          case Hls.ErrorDetails.LEVEL_LOAD_ERROR:
            await nudge(String(data?.details));
            return;
        }
        return;
      }

      // Try standard recoveries before reloading URL
      if (data?.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try {
          log("fatal media error; recoverMediaError()");
          hls.recoverMediaError();
          return;
        } catch {}
      }
      if (data?.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try {
          log("fatal network error; startLoad()");
          hls.startLoad();
          return;
        } catch {}
      }

      // Fatal → try once with a fresh URL
      clearTimers();
      try {
        const fresh = await fetchUrl();
        if (fresh && !cancelledRef.current) {
          const refreshed = buildPlaylistUrl(fresh.url);
          log("fatal; reload source", refreshed);
          hls.loadSource(refreshed);
          hls.attachMedia(video);
          await video.play().catch(() => {});
          return;
        }
      } catch (e: any) {
        log("fatal; refresh failed", e?.message);
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

    armStartWatchdog(async () => {
      if (cancelledRef.current || startRetryDoneRef.current) return;
      startRetryDoneRef.current = true;
      log("startup watchdog fired → refresh + reattach");
      try {
        const fresh = await fetchUrl();
        if (fresh) {
          try { hlsRef.current?.destroy(); } catch {}
          hlsRef.current = null;
          const v = videoRef.current;
          if (v) {
            try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
          }
          attachInFlight.current = false;
          await attach();
          return;
        }
      } catch {}
      if (!cancelledRef.current) {
        setError("Starting up is taking longer than usual. Retrying…");
        setStatus("preparing");
      }
    });

    try {
      const first = await fetchUrl();
      if (!first) return;
      let signedUrl = first.url;

      // If we have a non-zero startTime (Resume), skip progressive
      // and go straight to HLS, which already handles resume correctly.
      const wantsResume =
        typeof opts?.startTime === "number" &&
        Number.isFinite(opts.startTime) &&
        opts.startTime > 0;

      if (!wantsResume) {
        try {
          const ok = await tryProgressiveAttach(signedUrl);
          if (ok) return; // progressive MP4 path handled playback
        } catch {}
      }

      const u0 = asAbsolute(signedUrl);
      const nasOrigin0 = `${u0.protocol}//${u0.host}`;
      const tok0 = u0.searchParams.get("token") || "";
      if (tok0) lastTokenRef.current = tok0;

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

      const primingUrl = buildPlaylistUrl(playlistUrl);
      log("priming playlist HEAD", primingUrl);
      try {
        await fetch(primingUrl, { method: "HEAD", credentials: "include" });
      } catch {}

      await new Promise((r) => setTimeout(r, 250));
      if (cancelledRef.current) return;

      const video = videoRef.current!;
      (video as any).playsInline = true;

      // bind verbose video element listeners
      const onVE = (name: string) => () => log("video", name, {
        readyState: video.readyState,
        ct: video.currentTime.toFixed(3)
      });
      video.addEventListener("error", () => {
        const m = (video.error && (video.error as any).message) || (video.error && video.error.code);
        log("video ERROR", m);
        setError(typeof m === "string" ? m : "Video error");
      });
      ["waiting","stalled","suspend","progress","canplay","playing","pause","ended"].forEach(evt =>
        video.addEventListener(evt as any, onVE(evt))
      );
      video.addEventListener("timeupdate", () => {
        lastTimeupdateRef.current = Date.now();

        // Once we've progressed >2s past the resume target, stop treating as unsettled.
        const st = startTargetRef.current ?? 0;
        if (!startSettledRef.current && Number.isFinite(st) && st > 0) {
          if (video.currentTime >= st + 2) {
            startSettledRef.current = true;
          }
        }
      });

      // ✅ Only use native HLS on TRUE Safari
      if (isTrueSafari() && video.canPlayType("application/vnd.apple.mpegurl")) {
        log("native HLS attach (Safari)", primingUrl);
        video.src = primingUrl;

        // Seek once after metadata
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1 /* HAVE_METADATA */) {
            applyStartTimeOnce(video);
            resolve();
            return;
          }
          const onMeta = () => {
            video.removeEventListener("loadedmetadata", onMeta);
            applyStartTimeOnce(video);
            resolve();
          };
          video.addEventListener("loadedmetadata", onMeta);
        });

        // Reinforce once enough data is buffered; helps when early PTS shifts occur
        await new Promise<void>((resolve) => {
          if (video.readyState >= 3 /* HAVE_FUTURE_DATA */) {
            reassertStartIfDrift(video);
            resolve();
            return;
          }
          const onCanplay = () => {
            video.removeEventListener("canplay", onCanplay);
            reassertStartIfDrift(video);
            resolve();
          };
          video.addEventListener("canplay", onCanplay);
        });

        armNoProgressWatchdog(video);
        // If native attach stalls...
        const fallbackTimer = setTimeout(() => {
          if (cancelledRef.current) return;
          if (video.paused) return; // ✅ DO NOT fallback if user paused
          const stuckAtZero = (video.currentTime === 0 && video.videoWidth === 0)
          || (video.readyState < 2 /* HAVE_CURRENT_DATA */);
          if (stuckAtZero) {
            log("native attach stalled; switching to hls.js");
            attachWithHlsJs(video, primingUrl);
          }
        }, 1200);

        await video.play().catch(() => {});
        if (!cancelledRef.current) {
          clearTimers();
          setStatus("ready");
        }

        // clear the native fallback if things actually started
        setTimeout(() => clearTimeout(fallbackTimer), 3000);
        return;
      }

      // Otherwise → hls.js (Chrome/Firefox/Edge/etc.)
      if (Hls.isSupported()) {
        await attachWithHlsJs(video, primingUrl);
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
    tryProgressiveAttach,
    status,
    attachWithHlsJs,
    opts?.startTime,
  ]);

  // Kick off / cleanup
  useEffect(() => {
    cancelledRef.current = false;
    resumeAppliedRef.current = false;

    if (!mediaId) return;
    if (authLoading) {
      if (status === "idle") setError(null);
      return;
    }
    if (!user) {
      setStatus("idle");
      setError("Not signed in");
      return;
    }

    setStatus("loading");
    return () => {
      cancelledRef.current = true;
      clearTimers();
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.removeAttribute("src");
          videoRef.current.load();
        } catch {}
      }
      attachInFlight.current = false;
      retryCountRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, authLoading, user]);

  useEffect(() => {
    if (status !== "loading") return;
    if (!mediaId || authLoading || !user) return;
    if (attachInFlight.current) return;
    attach().catch((e) => {
      setError(e?.message || "Failed to start playback");
      setStatus("error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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

  // Token refresh (respect the same Safari vs. hls.js split)
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

        const uf = asAbsolute(fresh.url);
        const tkn = uf.searchParams.get("token");
        if (tkn) lastTokenRef.current = tkn;

        const refreshed = buildPlaylistUrl(fresh.url);

        if (isTrueSafari() && v.canPlayType("application/vnd.apple.mpegurl")) {
          const wasPaused = v.paused;
          const prevCT = Number.isFinite(v.currentTime) ? v.currentTime : 0;

          v.src = refreshed;

          await new Promise<void>((resolve) => {
            if (v.readyState >= 1 /* HAVE_METADATA */) {
              resolve();
              return;
            }
            const onMeta = () => {
              v.removeEventListener("loadedmetadata", onMeta);
              resolve();
            };
            v.addEventListener("loadedmetadata", onMeta);
          });

          // Do NOT re-apply initial startTime here; just preserve where the user was.
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
