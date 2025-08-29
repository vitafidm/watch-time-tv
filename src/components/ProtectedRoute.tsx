"use client";

import React from 'react';
import Link from 'next/link';
import { useAuthUser } from '@/hooks/useAuthUser';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Lock } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuthUser();

  if (loading) {
    return (
        <div className="space-y-4">
            <Skeleton className="h-10 w-1/4" />
            <div className="p-4 border rounded-lg">
                <Skeleton className="h-8 w-full mb-4" />
                <Skeleton className="h-8 w-full" />
            </div>
        </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-muted rounded-lg py-20">
          <Lock className="h-16 w-16 text-muted-foreground" />
          <h2 className="mt-6 text-2xl font-headline text-foreground">Access Denied</h2>
          <p className="mt-2 text-muted-foreground">Please sign in to view this page.</p>
          <div className="mt-6 flex gap-4">
            <Button asChild>
                <Link href="/signin">Sign In</Link>
            </Button>
            <Button asChild variant="secondary">
                <Link href="/signup">Sign Up</Link>
            </Button>
          </div>
      </div>
    );
  }

  return <>{children}</>;
}
