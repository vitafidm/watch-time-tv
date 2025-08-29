
"use client"

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthState } from 'react-firebase-hooks/auth';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase.client';
import type { ServerDoc } from '@/lib/db.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusCircle } from 'lucide-react';

function ServerStatusBadge({ status }: { status: ServerDoc['status'] }) {
    const variant = status === 'linked' ? 'default' : status === 'pending' ? 'secondary' : 'destructive';
    const className = status === 'linked' ? 'bg-green-500/20 text-green-400 border-green-400/20' : 'bg-yellow-500/20 text-yellow-400 border-yellow-400/20'
    return <Badge variant="outline" className={className}>{status}</Badge>;
}

export default function SettingsPage() {
  const [user, authLoading, authError] = useAuthState(auth);
  const [servers, setServers] = useState<ServerDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      const q = query(collection(db, `users/${user.uid}/servers`), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const serverData = snapshot.docs.map(doc => ({ ...doc.data(), serverId: doc.id } as ServerDoc));
        setServers(serverData);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching servers:", error);
        setLoading(false);
      });

      return () => unsubscribe();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-headline text-4xl font-bold tracking-tight">Settings</h1>
        <Card>
          <CardHeader>
            <CardTitle>Your Servers</CardTitle>
            <CardDescription>Manage your connected media servers.</CardDescription>
          </CardHeader>
          <CardContent>
             <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center">
        <p>Please sign in to manage your settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-headline text-4xl font-bold tracking-tight">Settings</h1>
        <Button asChild>
          <Link href="/settings/connect">
            <PlusCircle className="mr-2 h-4 w-4" />
            Connect New Server
          </Link>
        </Button>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Your Servers</CardTitle>
          <CardDescription>A list of your connected media servers.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Agent Version</TableHead>
                <TableHead>Server ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.length > 0 ? (
                servers.map((server) => (
                  <TableRow key={server.serverId}>
                    <TableCell className="font-medium">{server.name || 'Unnamed Agent'}</TableCell>
                    <TableCell><ServerStatusBadge status={server.status} /></TableCell>
                    <TableCell>{server.agentVersion || 'N/A'}</TableCell>
                    <TableCell className="font-mono text-xs">{server.serverId}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">
                    You haven't connected any servers yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
