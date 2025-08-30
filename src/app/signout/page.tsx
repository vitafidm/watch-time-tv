"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase.client';
import { RefreshCw } from 'lucide-react';

export default function SignOutPage() {
  const router = useRouter();

  useEffect(() => {
    const performSignOut = async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Error signing out: ", error);
      } finally {
        router.push('/');
      }
    };
    performSignOut();
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
      <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="mt-4 text-muted-foreground">Signing you out...</p>
    </div>
  );
}
