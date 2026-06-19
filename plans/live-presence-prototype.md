# Live Presence — Working Prototype & Implementation Asset

**Status:** Prototype built (dev-only). Validates `plans/live-presence-indicator-research.md`.
**Date:** 2026-06-19

This is a **handoff asset** for the agent that implements live presence in the real
app. A working SSE prototype exists behind dev-only routes; the core is a clean,
tested, framework-agnostic module you should **lift as-is**. The throwaway route +
playground show it working and are meant to be deleted.

---

## What's here

| File                                     | Keep / throwaway                  | Purpose                                                                                                 |
| ---------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app/lib/presence.server.ts`             | **KEEP — production-ready**       | In-memory presence registry + per-room fan-out. The reusable core.                                      |
| `app/lib/presence.server.test.ts`        | **KEEP**                          | 6 unit tests for the registry (join/leave, distinct keys, isolation, subscribe, TTL sweep, avatar cap). |
| `app/routes/api.dev.presence.$roomId.ts` | Throwaway (dev-only, 404 in prod) | SSE transport — the **reference pattern** for the real route.                                           |
| `app/routes/dev.presence.tsx`            | Throwaway (dev-only, 404 in prod) | Manual playground: opt-in toggle, live count + avatars, "Simulate viewer".                              |
| route entries in `app/routes.ts`         | Throwaway                         | Registers the two dev routes. Remove when productionizing.                                              |

**Try it:** `pnpm dev` → http://localhost:5173/dev/presence. Open in two browsers,
or click **Simulate viewer**. Toggle **Visible** to see opt-in vs observe-only.

Verified end-to-end: an observer (`optIn=0`) sees `count: 1` while an opted-in
viewer is connected; closing the connection broadcasts `count: 0`.

---

## The reusable module: `~/lib/presence.server`

Framework- and transport-agnostic. Knows nothing about SSE/HTTP/React Router.

```ts
join({ roomId, key, avatarSeed, now? }): () => void  // returns idempotent leave()
touch({ roomId, key, now? }): void                   // heartbeat → refresh liveness
subscribe(roomId, (snapshot) => void): () => void    // returns unsubscribe()
getSnapshot(roomId): { count, avatarSeeds }          // count = distinct keys
sweep(now?): string[]                                 // prune stale; returns rooms
ensureSweepTimer(): void                              // idempotent background sweep
// constants: PRESENCE_TTL_MS (60s), KEEPALIVE_MS (25s), MAX_AVATARS (12)
```

Semantics worth knowing:

- **`count` = distinct `key`s, not connections.** Same `key` from two tabs counts
  once; the member leaves only when its last connection closes.
- **`avatarSeeds` is capped at `MAX_AVATARS`**; `count` is not.
- **`leave()` is the graceful path; `sweep()` is the backup** for ungraceful drops
  (the connection died without firing abort). Sweep prunes by `lastSeen` regardless
  of connection count.
- **`now?` params exist for deterministic tests** — pass real time in production
  (defaults to `Date.now()`).

---

## How to productionize (steps for the implementing agent)

1. **Real SSE route, not dev.** Replace `api.dev.presence.$roomId.ts` with a real
   resource route, e.g. `api.lessons.$lessonId.presence.ts`. Copy the streaming
   body verbatim — the `ReadableStream` + headers + cleanup-on-abort pattern is the
   part that's fiddly and already correct:
   - headers: `text/event-stream`, `Cache-Control: no-cache, no-transform`,
     `Connection: keep-alive`, `X-Accel-Buffering: no`; **no compression**.
   - `subscribe` **before** `join` so the client receives its own join event.
   - clean up (`clearInterval`, `unsubscribe`, `leave`) on `request.signal` abort
     **and** in `cancel()`.
2. **Authorization.** Gate the route on the current user + **enrollment** (mirror the
   existing lesson route's access check). Drop the `import.meta.env.PROD` 404 guard.
3. **Anonymized key — server-side, not client-supplied.** The prototype trusts a
   client `key`/`seed` query param. In production, derive the `key` server-side from
   the session (e.g. a per-session random token stored in the cookie session) so a
   client can't spoof identity or inflate the count. Derive `avatarSeed` from that
   token (e.g. a hash) so avatars are stable-but-anonymous.
4. **Opt-in preference.** Decide where it lives (research §9 Q1): cookie/session
   (no migration, per-device) vs a `users` column (cross-device). Only `join` when
   opted in; always `subscribe` so opted-out viewers still see the count.
5. **Client component.** Lift the `EventSource` wiring from `dev.presence.tsx` into a
   `<LessonPresence lessonId optedIn>` component rendered in
   `courses.$slug.lessons.$lessonId.tsx`. Reuse the dashboard's overlapping
   avatar-stack styling. **Close the `EventSource` on unmount.**
6. **Start the sweep.** Call `ensureSweepTimer()` once from the route (already done
   in the prototype).

---

## What the prototype intentionally does NOT do (left for production)

- **No enrollment/auth gating** (dev-only, so it's open).
- **Client-supplied `key`/`seed`** — must move server-side (step 3).
- **No persisted opt-in** — the toggle is in-memory per page load.
- **Single-process only.** For multi-instance, swap the module internals for Redis
  pub/sub behind the same exported surface (research §7). Nothing else changes.
- **No real lesson UI integration** — it runs against a fake `demo-lesson` room.

---

## Cleanup checklist when the real feature lands

- [ ] Delete `app/routes/dev.presence.tsx` and `app/routes/api.dev.presence.$roomId.ts`.
- [ ] Remove their two entries from `app/routes.ts`.
- [ ] Keep `app/lib/presence.server.ts` + its test (now used by the real route).
- [ ] Delete this file and (optionally) fold notes into the real plan.
