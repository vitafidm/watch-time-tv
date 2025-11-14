// src/components/PlayerDialog.tsx
"use client";

import { Dialog, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { useCallback } from "react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mediaId: string | number | null;
  title?: string;
  startTime?: number | null;
};

export function PlayerDialog({ open, onOpenChange, mediaId, title, startTime }: Props) {
  const handleClose = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {/* noop */}
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="max-w-[100vw] w-[100vw] h-[100vh] p-0 bg-black border-none rounded-none">
        {/* a11y title (hidden visually) */}
        <VisuallyHidden>
          <DialogTitle>{title?.trim() || "Video player"}</DialogTitle>
        </VisuallyHidden>

        

        {/* video */}
        <div className="absolute inset-0">
          <VideoPlayer
            mediaId={mediaId ? String(mediaId) : null}
            className="h-full w-full"
            autoPlay
            controls
            startAtSeconds={typeof startTime === "number" ? Math.max(0, startTime) : 0}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
