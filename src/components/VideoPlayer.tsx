// src/components/VideoPlayer.tsx
"use client";
import React from 'react';
import { useHlsPlayback } from '@/hooks/useHlsPlayback';

type Props = {
  mediaId: string | null;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
};

export function VideoPlayer({ mediaId, className, autoPlay = true, controls = true, muted = false }: Props) {
  const { videoRef, status, error } = useHlsPlayback(mediaId);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        className="w-full h-auto bg-black rounded-xl"
      />
      <div className="mt-2 text-sm text-muted-foreground">
        {status === 'loading' && <span>Loading stream…</span>}
        {status === 'ready' && <span>Playing</span>}
        {status === 'error' && <span className="text-red-500">Error: {error}</span>}
      </div>
    </div>
  );
}
