
"use client"

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import type { ServerDoc } from '@/lib/db.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusCircle } from 'lucide-react';
import { useAuthUser } from '@/hooks/useAuthUser';
import ProtectedRoute from '@/components/ProtectedRoute';

function ServerStatusBadge({ status }: { status: ServerDoc['status'] }) {
    const variant = status === 'linked' ? 'default' : status === 'pending' ? 'secondary' : 'destructive';
    const className = status === 'linked' ? 'bg-green-500/20 text-green-400 border-green-400/20' : 'bg-yellow-500/20 text-yellow-400 border-yellow-400/20'
    return <Badge variant="outline" className={className}>{status}</Badge>;
}

function Settings() {
  const { user } = useAuthUser();
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
    } else {
        // If there's no user, we're not loading data, so set loading to false.
        // This can happen if the user signs out.
        setLoading(false);
        setServers([]); // Clear servers on sign out
    }
  }, [user]);

  // We rely on the ProtectedRoute to handle the loading state until user is determined.
  // The internal loading is for the Firestore query.
  if (!user) return null;


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
          {loading ? (
             <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
             </div>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}


export default function SettingsPage() {
    return (
        <ProtectedRoute>
            <Settings />
        </ProtectedRoute>
    )
}
