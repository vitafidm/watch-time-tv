
"use client";

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { VideoPlayer } from './VideoPlayer';

export type PlayerDialogProps = {
  mediaId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  "data-testid"?: string;
};

export function PlayerDialog({
  mediaId,
  open,
  onOpenChange,
  title,
  "data-testid": dataTestId = "player-dialog",
}: PlayerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-full p-0 border-0 bg-black"
        data-testid={dataTestId}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {title && (
          <DialogHeader className="absolute top-0 left-0 z-10 p-4 bg-gradient-to-b from-black/70 to-transparent w-full">
            <DialogTitle className="text-white text-lg font-bold drop-shadow-md">
              {title}
            </DialogTitle>
          </DialogHeader>
        )}
        <div className="aspect-video w-full rounded-lg overflow-hidden">
            {open && mediaId && <VideoPlayer mediaId={mediaId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
