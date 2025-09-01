"use client";

import { useState } from "react";
import { useServerConfig } from "@/hooks/useServerConfig";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Wifi, ScanLine, UploadCloud, RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function cleanBaseUrl(s?: string) {
  return (s || "").replace(/\/+$/, "");
}

type Msg = { kind: "ok" | "err"; text: React.ReactNode };

export default function NasActions() {
  const { config } = useServerConfig();
  const { toast } = useToast();
  const base = cleanBaseUrl(config.backendUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const isBusy = !!busy;
  const isDisabled = !base || isBusy;

  async function hit(path: string, init?: RequestInit) {
    const url = `${base}${path}`;
    const r = await fetch(url, {
      method: "GET",
      ...(init || {}),
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const t = await r.text();
    let body: any = null;
    try {
      body = t ? JSON.parse(t) : null;
    } catch {
      body = { raw: t };
    }
    return { ok: r.ok, status: r.status, body, url };
  }

  async function onHealth() {
    setBusy("health");
    setMsg(null);
    try {
      const res = await hit("/health");
      if (!res.ok) throw new Error(`Health check failed with status ${res.status}`);
      setMsg({ kind: "ok", text: `✅ Connection to ${res.url} was successful!` });
      toast({ title: "Connection Successful", description: "The health check passed." });
    } catch (e: any) {
      setMsg({ kind: "err", text: `❌ Health check failed: ${e?.message || e}` });
      toast({ title: "Connection Failed", description: e?.message || "Could not connect to the backend.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function onScan() {
    setBusy("scan");
    setMsg(null);
    try {
      const res = await hit("/scan", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
      const count = Array.isArray(res.body?.items) ? res.body.items.length : 0;
      setMsg({ kind: "ok", text: `✅ Scan complete. Found ${count} items locally.` });
      toast({ title: "Scan Complete", description: `Found ${count} items on your NAS.` });
    } catch (e: any) {
      setMsg({ kind: "err", text: `❌ Scan failed: ${e?.message || e}` });
      toast({ title: "Scan Failed", description: e?.message || "Could not complete the scan.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function onPush() {
    setBusy("push");
    setMsg(null);
    try {
      const res = await hit("/push", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
      const status = res.body?.status ?? 200;
      const results = res.body?.body?.results;
      const summary = Array.isArray(results)
        ? `${results.length} items processed, ${results.filter((r: any) => r.status === "upserted").length} upserted.`
        : "no per-item detail available.";
      setMsg({
        kind: "ok",
        text: (
          <>
            ✅ Push to Firestore finished.
            <br />
            Function status: {status} ({summary})
          </>
        ),
      });
      toast({ title: "Sync Complete", description: summary });
    } catch (e: any) {
      setMsg({ kind: "err", text: `❌ Sync failed: ${e?.message || e}` });
      toast({ title: "Sync Failed", description: e?.message || "Could not sync data to Firestore.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>NAS Actions</CardTitle>
        <CardDescription>Manually trigger actions on your connected Direct NAS backend.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Button disabled={isDisabled} onClick={onHealth}>
            {busy === "health" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
            {busy === "health" ? "Checking…" : "Test Connection"}
          </Button>
          <Button disabled={isDisabled} onClick={onScan}>
            {busy === "scan" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
            {busy === "scan" ? "Scanning…" : "Scan Catalog"}
          </Button>
          <Button disabled={isDisabled} onClick={onPush}>
            {busy === "push" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
            {busy === "push" ? "Syncing…" : "Sync to Firestore"}
          </Button>
        </div>

        {!base && !isBusy && (
          <p className="text-sm text-muted-foreground">
            Save a valid Backend URL in the form above to enable actions.
          </p>
        )}

        {msg && (
          <Alert variant={msg.kind === "ok" ? "default" : "destructive"}>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{msg.kind === "ok" ? "Success" : "Error"}</AlertTitle>
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
