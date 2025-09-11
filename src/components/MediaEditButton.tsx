
"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MediaEditButtonProps {
  onOpen: () => void;
  className?: string;
}

export function MediaEditButton({ onOpen, className }: MediaEditButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen();
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      className={cn(
        "absolute top-1 right-1 z-10 h-8 w-8 rounded-full bg-background/60 text-foreground/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-background/80 hover:text-foreground",
        className
      )}
      aria-label="Edit media"
    >
      <MoreHorizontal className="h-5 w-5" />
    </Button>
  );
}
