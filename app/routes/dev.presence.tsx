import { useEffect, useRef, useState } from "react";
import { data, Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/dev.presence";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Eye, Radio, UserPlus, AlertTriangle } from "lucide-react";

// ─── THROWAWAY DEV-ONLY PROTOTYPE ───
// Manual playground for the live presence indicator (see
// plans/live-presence-prototype.md). Dev-only: the loader 404s in production.

export function meta() {
  return [{ title: "Dev · Presence prototype" }];
}

export async function loader() {
  if (import.meta.env.PROD) {
    throw data("Not found", { status: 404 });
  }
  return { roomId: "demo-lesson" };
}

interface Snapshot {
  count: number;
  avatarSeeds: string[];
}

const AVATAR = (seed: string) =>
  `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;

/** One simulated viewer = one EventSource connection (own key + seed). */
function useSimulatedViewers(roomId: string) {
  const [keys, setKeys] = useState<string[]>([]);
  const sources = useRef<Map<string, EventSource>>(new Map());

  const add = () => {
    const key = crypto.randomUUID();
    const es = new EventSource(
      `/api/dev/presence/${roomId}?optIn=1&key=${key}&seed=${key.slice(0, 8)}`
    );
    sources.current.set(key, es);
    setKeys((k) => [...k, key]);
  };

  const remove = () => {
    const last = keys[keys.length - 1];
    if (!last) return;
    sources.current.get(last)?.close();
    sources.current.delete(last);
    setKeys((k) => k.slice(0, -1));
  };

  useEffect(() => {
    const map = sources.current;
    return () => {
      for (const es of map.values()) es.close();
      map.clear();
    };
  }, []);

  return { simulated: keys.length, add, remove };
}

export default function DevPresence({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const [optIn, setOptIn] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    count: 0,
    avatarSeeds: [],
  });
  const [connected, setConnected] = useState(false);
  const keyRef = useRef<string>(crypto.randomUUID());
  const { simulated, add, remove } = useSimulatedViewers(roomId);

  // My own presence stream — reconnects whenever the opt-in toggle changes.
  useEffect(() => {
    const key = keyRef.current;
    const es = new EventSource(
      `/api/dev/presence/${roomId}?optIn=${optIn ? "1" : "0"}&key=${key}&seed=${key.slice(0, 8)}`
    );
    es.onopen = () => setConnected(true);
    es.addEventListener("presence", (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [roomId, optIn]);

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Dev · Presence</span>
      </nav>

      <div className="mb-2 flex items-center gap-2">
        <Radio className="size-5 text-violet-500" />
        <h1 className="text-2xl font-bold">Live presence prototype</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Dev-only playground for <code>~/lib/presence.server</code> over SSE.
        Open this page in two browsers, or use “Simulate viewer” below. Room:{" "}
        <code>{roomId}</code>.
      </p>

      {/* Live indicator */}
      <Card className="mb-6 overflow-hidden border-0 bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white">
        <CardContent className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">
              {snapshot.avatarSeeds.length === 0 ? (
                <span className="text-sm text-white/80">
                  No one visible yet
                </span>
              ) : (
                snapshot.avatarSeeds.map((seed) => (
                  <img
                    key={seed}
                    src={AVATAR(seed)}
                    alt="viewer"
                    className="size-9 rounded-full bg-white/90 ring-2 ring-violet-500"
                  />
                ))
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1.5 text-2xl font-bold">
              <Eye className="size-5" />
              {snapshot.count}
            </div>
            <div className="text-xs text-white/80">watching now</div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Appear to others as watching</p>
              <p className="text-sm text-muted-foreground">
                Opt-in, off by default. Off = you still see the count, but
                aren’t counted.
              </p>
            </div>
            <Button
              variant={optIn ? "default" : "outline"}
              onClick={() => setOptIn((v) => !v)}
            >
              {optIn ? "Visible: ON" : "Visible: OFF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button variant="outline" onClick={add}>
            <UserPlus className="mr-2 size-4" />
            Simulate viewer
          </Button>
          <Button variant="ghost" onClick={remove} disabled={simulated === 0}>
            Remove one
          </Button>
          <span className="text-sm text-muted-foreground">
            {simulated} simulated · stream{" "}
            <span className={connected ? "text-green-600" : "text-amber-600"}>
              {connected ? "connected" : "disconnected"}
            </span>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">
          {is404 ? "Not available" : "Something went wrong"}
        </h1>
        <p className="mb-6 text-muted-foreground">
          {is404
            ? "This prototype is only available in development."
            : "An unexpected error occurred."}
        </p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
