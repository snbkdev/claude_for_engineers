import { data } from "react-router";
import type { Route } from "./+types/api.dev.presence.$roomId";
import {
  join,
  touch,
  subscribe,
  getSnapshot,
  ensureSweepTimer,
  KEEPALIVE_MS,
  type PresenceSnapshot,
} from "~/lib/presence.server";

// ─── THROWAWAY DEV-ONLY PROTOTYPE ───
// SSE transport demonstrating ~/lib/presence.server. Dev-only (404 in prod).
// The real implementation should mirror this against a real lesson route with
// enrollment gating + an anonymized per-session key (see
// plans/live-presence-prototype.md). Resource route: no default export.

export async function loader({ request, params }: Route.LoaderArgs) {
  if (import.meta.env.PROD) {
    throw data("Not found", { status: 404 });
  }

  const roomId = params.roomId;
  const url = new URL(request.url);
  // Opt-in: only opted-in viewers register as present. Everyone may subscribe.
  const optIn = url.searchParams.get("optIn") === "1";
  // Anonymized identity for this connection (prototype: client-supplied).
  const key = url.searchParams.get("key") ?? crypto.randomUUID();
  const avatarSeed = url.searchParams.get("seed") ?? key.slice(0, 8);

  ensureSweepTimer();

  const encoder = new TextEncoder();
  let leave: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendSnapshot = (snapshot: PresenceSnapshot) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: presence\ndata: ${JSON.stringify(snapshot)}\n\n`
            )
          );
        } catch {
          // Controller already closed (client gone); cleanup handles the rest.
        }
      };

      // 1) Initial snapshot, 2) live updates, 3) register self if opted in.
      sendSnapshot(getSnapshot(roomId));
      unsubscribe = subscribe(roomId, sendSnapshot);
      if (optIn) leave = join({ roomId, key, avatarSeed });

      // Keep-alive comment frame + heartbeat to refresh liveness.
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // closed; ignore
        }
        if (optIn) touch({ roomId, key });
      }, KEEPALIVE_MS);
      keepAlive.unref?.();

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (leave) leave();
    leave = null;
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable nginx buffering so frames flush immediately (research §4.3).
      "X-Accel-Buffering": "no",
    },
  });
}
