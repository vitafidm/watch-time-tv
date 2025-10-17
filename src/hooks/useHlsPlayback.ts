// src/hooks/useHlsPlayback.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { getPlaybackUrl } from '@/lib/startPlayback';
import { useAuthUser } from '@/hooks/useAuthUser';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function useHlsPlayback(mediaId: string | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const { user } = useAuthUser();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  // fetch fresh signed url
  const fetchUrl = useCallback(async () => {
    if (!user) throw new Error('Not signed in');
    if (!mediaId) throw new Error('Missing mediaId');
    const idToken = await user.getIdToken(true);
    const { url, expiresAt } = await getPlaybackUrl(mediaId, idToken);
    setCurrentUrl(url);
    setExpiresAt(expiresAt);
    return { url, expiresAt };
  }, [user, mediaId]);

  // attach source to video element
  const attach = useCallback(async () => {
    if (!videoRef.current) return;
    setStatus('loading');
    setError(null);

    const { url } = await fetchUrl();

    // Native HLS: Safari/iOS
    const canNative = videoRef.current.canPlayType('application/vnd.apple.mpegurl');
    if (canNative) {
      videoRef.current.src = url;
      await videoRef.current.play().catch(() => {});
      setStatus('ready');
      return;
    }

    // hls.js for other browsers
    if (Hls.isSupported()) {
      // tear down prior
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const hls = new Hls({
        // a bit of headroom; default config is fine for now
        enableWorker: true,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, async (_event, data) => {
        // Token expiry will usually surface as a network error on playlist/segment fetch.
        // On fatal network/media errors, try once to refresh the URL and recover.
        if (data?.fatal) {
          try {
            // Try re-minting the URL and swapping source in-place
            const { url: fresh } = await fetchUrl();
            hls.loadSource(fresh);
            hls.attachMedia(videoRef.current!);
            await videoRef.current!.play().catch(() => {});
          } catch (e: any) {
            setError(e?.message || 'Playback error');
            setStatus('error');
          }
        }
      });

      hls.loadSource(url);
      hls.attachMedia(videoRef.current);

      // Some browsers need an explicit play() after attachment
      await videoRef.current.play().catch(() => {});

      setStatus('ready');
      return;
    }

    // Neither native nor hls.js supported
    setError('HLS not supported in this browser.');
    setStatus('error');
  }, [fetchUrl]);

  // initial attach when mediaId changes
  useEffect(() => {
    if (!mediaId) return;
    attach().catch((e) => {
      setError(e?.message || 'Failed to start playback');
      setStatus('error');
    });
    // cleanup on unmount / mediaId change
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch {}
      }
    };
  }, [mediaId, attach]);

  // proactive refresh a little before expiry (e.g., 30s buffer)
  useEffect(() => {
    if (!expiresAt) return;
    const now = Math.floor(Date.now() / 1000);
    const secondsLeft = expiresAt - now;
    const refreshIn = Math.max(1, (secondsLeft - 30)) * 1000; // ms
    const t = setTimeout(async () => {
      try {
        const { url: fresh } = await fetchUrl();
        if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
          // Native: swap src
          const wasPaused = videoRef.current.paused;
          videoRef.current.src = fresh;
          if (!wasPaused) await videoRef.current.play().catch(() => {});
        } else if (hlsRef.current) {
          // hls.js: reload source
          hlsRef.current.loadSource(fresh);
          hlsRef.current.attachMedia(videoRef.current!);
        }
      } catch (e: any) {
        // Non-fatal; player may hit the error handler and recover there
        console.warn('[playback] token refresh failed:', e?.message || e);
      }
    }, refreshIn);
    return () => clearTimeout(t);
  }, [expiresAt, fetchUrl]);

  return { videoRef, status, error, currentUrl, refresh: attach };
}
