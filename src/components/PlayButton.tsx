
"use client";

import * as React from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'absolute bottom-3 right-3 z-10 flex items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      size: {
        sm: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
        md: 'h-10 w-10 [&_svg]:h-5 [&_svg]:w-5',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

export type PlayButtonProps = {
  onClick?: () => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  asNavigateHref?: string;
  "data-testid"?: string;
} & VariantProps<typeof buttonVariants>;

export function PlayButton({
  onClick,
  label = 'Play',
  className,
  disabled,
  asNavigateHref,
  size = 'md',
  'data-testid': dataTestId = 'play-btn',
}: PlayButtonProps) {
  
  const commonProps = {
    'aria-label': label,
    'data-testid': dataTestId,
    className: cn(buttonVariants({ size }), className),
  };

  if (asNavigateHref) {
    return (
      <Link href={asNavigateHref} {...commonProps}>
        <Play className="fill-current" />
      </Link>
    );
  }

  return (
    <button onClick={onClick} disabled={disabled} {...commonProps}>
      <Play className="fill-current" />
    </button>
  );
}
