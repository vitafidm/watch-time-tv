
"use client"

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase.client';
import type { ServerDoc } from '@/lib/db.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Copy, Check, ExternalLink, RefreshCw, XCircle, CheckCircle, Hourglass, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useAuthUser } from '@/hooks/useAuthUser';

type WizardState = 'idle' | 'generating' | 'waiting' | 'linked' | 'expired' | 'error';

interface TokenData {
  serverId: string;
  claimPublicId: string;
  claimSecret: string;
  expiresAtISO: string;
}

const claimTokenUrl = process.env.NEXT_PUBLIC_CLAIM_TOKEN_URL;

export default function ConnectPage() {
  const { user, loading: authLoading } = useAuthUser();
  const { toast } = useToast();

  const [wizardState, setWizardState] = useState<WizardState>('idle');
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [linkedServer, setLinkedServer] = useState<ServerDoc | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [copiedField, setCopiedField] = useState<string | null>(null);

  const resetWizard = () => {
    setWizardState('idle');
    setTokenData(null);
    setLinkedServer(null);
    setRemainingMs(null);
    setError(null);
  };
  
  const handleGenerateToken = useCallback(async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be signed in to generate a token.", variant: "destructive" });
      return;
    }
    if (!claimTokenUrl) {
      setError("The claim token URL is not configured by the administrator.");
      setWizardState('error');
      return;
    }

    setWizardState('generating');
    setError(null);

    try {
      const idToken = await user.getIdToken(true);
      const response = await fetch(claimTokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error?.message || 'Failed to generate token.');
      }
      
      setTokenData(result);
      setWizardState('waiting');

    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setWizardState('error');
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }, [user, toast]);

  // Countdown timer effect
  useEffect(() => {
    if (wizardState !== 'waiting' || !tokenData?.expiresAtISO) {
      if (remainingMs !== null) setRemainingMs(null);
      return;
    }

    const interval = setInterval(() => {
      const expiryTime = new Date(tokenData.expiresAtISO).getTime();
      const now = Date.now();
      const newRemaining = expiryTime - now;

      if (newRemaining <= 0) {
        setRemainingMs(0);
        setWizardState('expired');
        clearInterval(interval);
      } else {
        setRemainingMs(newRemaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [wizardState, tokenData]);


  // Firestore listener effect
  useEffect(() => {
    if (wizardState !== 'waiting' || !user || !tokenData?.serverId) {
      return;
    }

    const docRef = doc(db, `users/${user.uid}/servers`, tokenData.serverId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const serverData = docSnap.data() as ServerDoc;
        if (serverData.status === 'linked') {
          setLinkedServer(serverData);
          setWizardState('linked');
          unsubscribe();
        }
      }
    });

    return () => unsubscribe();

  }, [wizardState, user, tokenData?.serverId]);


  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast({ title: 'Copied!', description: `${fieldName} copied to clipboard.`});
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      toast({ title: 'Copy Failed', description: `Could not copy ${fieldName}.`, variant: 'destructive' });
    }
  };

  const dockerEnvSnippet = `CLAIM_PUBLIC_ID=${tokenData?.claimPublicId || ''}
CLAIM_SECRET=${tokenData?.claimSecret || ''}
AGENT_CLAIM_URL=${process.env.NEXT_PUBLIC_AGENT_CLAIM_URL || 'YOUR_AGENT_CLAIM_URL'}
AGENT_INGEST_URL=${process.env.NEXT_PUBLIC_AGENT_INGEST_URL || 'YOUR_AGENT_INGEST_URL'}`;

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const renderContent = () => {
    if (authLoading) return <div className="text-center p-8">Loading user...</div>;
    if (!user) return <div className="text-center p-8">Please sign in to connect a server.</div>;

    switch (wizardState) {
      case 'idle':
        return (
          <div className="text-center">
            <KeyRound className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">Generate a Claim Token</h3>
            <p className="mt-1 text-sm text-muted-foreground">Click the button to generate a secure, one-time token to link your local media agent.</p>
            <Button onClick={handleGenerateToken} className="mt-6">Generate Token</Button>
          </div>
        );
      case 'generating':
        return <div className="text-center p-8 flex items-center justify-center gap-2"><RefreshCw className="h-5 w-5 animate-spin" /> Generating token...</div>;
      
      case 'waiting':
        return (
          <div className="space-y-6">
            <div className="text-center border-2 border-dashed border-amber-500/50 bg-amber-500/10 rounded-lg p-4">
              <Hourglass className="mx-auto h-8 w-8 text-amber-400" />
              <p className="mt-2 font-semibold text-amber-300">Waiting for agent...</p>
              <p className="text-sm text-amber-400/80">
                Token expires in: <span className="font-mono font-bold">{remainingMs ? formatTime(remainingMs) : '00:00'}</span>
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">1. Copy these credentials into your agent:</h4>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input readOnly value={tokenData?.claimPublicId} placeholder="Claim Public ID" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(tokenData?.claimPublicId || '', 'Public ID')}>{copiedField === 'Public ID' ? <Check className="text-green-500" /> : <Copy />}</Button>
                </div>
                <div className="flex gap-2">
                  <Input readOnly type="password" value={tokenData?.claimSecret} placeholder="Claim Secret" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(tokenData?.claimSecret || '', 'Secret')}>{copiedField === 'Secret' ? <Check className="text-green-500" /> : <Copy />}</Button>
                </div>
              </div>
            </div>
            <div>
                <h4 className="font-semibold mb-2">2. Or, use this Docker environment snippet:</h4>
                <div className="relative">
                    <pre className="bg-muted text-muted-foreground p-4 rounded-md text-xs overflow-x-auto"><code>{dockerEnvSnippet}</code></pre>
                    <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={() => copyToClipboard(dockerEnvSnippet, 'Docker Snippet')}>{copiedField === 'Docker Snippet' ? <Check className="text-green-500"/> : <Copy />}</Button>
                </div>
            </div>
          </div>
        );

      case 'linked':
        return (
            <div className="text-center p-8 bg-green-500/10 rounded-lg">
                <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                <h3 className="mt-4 text-lg font-medium text-green-300">Server Linked Successfully!</h3>
                <p className="mt-1 text-sm text-green-400/80">
                    Your server "{linkedServer?.name || linkedServer?.serverId}" is now connected.
                </p>
                <Button asChild className="mt-6">
                    <Link href="/settings">View Servers</Link>
                </Button>
            </div>
        );

      case 'expired':
        return (
            <div className="text-center p-8 bg-red-500/10 rounded-lg">
                <XCircle className="mx-auto h-12 w-12 text-red-400" />
                <h3 className="mt-4 text-lg font-medium text-red-300">Token Expired</h3>
                <p className="mt-1 text-sm text-red-400/80">This claim token has expired. Please generate a new one.</p>
                <Button onClick={resetWizard} className="mt-6" variant="secondary">Generate New Token</Button>
            </div>
        );

      case 'error':
        return (
            <div className="text-center p-8 bg-red-500/10 rounded-lg">
                <XCircle className="mx-auto h-12 w-12 text-red-400" />
                <h3 className="mt-4 text-lg font-medium text-red-300">An Error Occurred</h3>
                <p className="mt-1 text-sm text-red-400/80">{error || 'An unknown error occurred.'}</p>
                <Button onClick={resetWizard} className="mt-6" variant="secondary">Try Again</Button>
            </div>
        );
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
         <h1 className="font-headline text-4xl font-bold tracking-tight">Connect a New Server</h1>
         <p className="text-muted-foreground mt-2">Follow the steps below to link a new local media agent.</p>
      </div>

      <Card>
        <CardContent className="p-6">
          {renderContent()}
        </CardContent>
      </Card>
      
      <div className="text-center">
        <Button variant="link" asChild>
            <Link href="/settings">
                <ExternalLink className="mr-2 h-4 w-4" />
                Back to Server List
            </Link>
        </Button>
      </div>
    </div>
  );
}
