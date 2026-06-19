# Live Presence Indicator — Research & Implementation Plan

**Status:** Research / pre-implementation
**Date:** 2026-06-19
**Feature:** Show students who else is viewing the _same lesson at the same time_ —
an opt-in, anonymized "X watching now" indicator with a cluster of avatars.

---

## 1. Goal & product decisions

A student watching a lesson sees a small **live presence indicator**: a count of
others currently on the same lesson, plus a cluster of **anonymized avatars**. The
intent is social proof / "I'm not alone" — not a chat or a roster.

Decisions locked in with the product owner:

| Decision         | Choice                                                                  | Implication                                                               |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **What we show** | Anonymized avatars + a live count                                       | No real names; avatars are recognizable-but-not-identifying               |
| **Privacy**      | **Opt-in, off by default**                                              | Only opted-in users are _counted/shown_; anyone may still _see_ the count |
| **Transport**    | **Server-Sent Events (SSE)**                                            | One-way push, broadcast-friendly, no new heavy infra                      |
| **Scale target** | "Realistic product" — hundreds of concurrent viewers per popular lesson | Single-node is fine now; documented seam to scale out (see §7)            |

Granularity is **per lesson** (`lessonId`), matching the unit students actually sit on.

---

## 2. Current architecture & constraints

These constraints drove every choice below (verified against the repo, 2026-06-19):

- **Single Node process.** Production is `react-router-serve` (one process); dev is
  `react-router dev`. No custom server, no `Dockerfile`, no multi-instance config.
- **SQLite via better-sqlite3 (synchronous, single file, WAL).** All DB access is
  synchronous through `app/services/*`. Writes serialize — unsuitable for a
  high-frequency heartbeat write path.
- **No realtime/transport dependencies** (no `ws`, `socket.io`, `redis`, `pusher`,
  `ably`, etc.). SSE needs **zero new packages** — it's just an HTTP response.
- **A heartbeat precedent already exists.** `app/routes/api.video-tracking.ts`
  already receives periodic play/pause/position pings from the lesson player
  (`logWatchEvent`). Presence "I'm still here" pings fit the same shape and the same
  client code can drive both.
- **React Router 7 resource routes can stream.** A route with no default export can
  `return new Response(stream, { headers })`; the framework's own file-upload how-to
  streams a `ReadableStream` exactly this way. We abort on `request.signal`.

---

## 3. Approaches considered (with external validation)

### A. Short polling (client re-fetches a count every ~10s)

- **Pros:** trivial; reuses the existing `useFetcher` pattern; no long-lived
  connections; survives restarts.
- **Cons:** not truly "live" (up to the poll interval of lag); at hundreds of
  viewers, N clients × every 10s = constant request churn; presence
  _departure_ is only detected on the next poll.
- **Verdict:** good fallback, but the product wants a _live_ feel and we chose SSE.

### B. Server-Sent Events (SSE) — **chosen**

- One-way server→client stream over a normal HTTP response (`text/event-stream`).
- **Memory:** ~2–5 KiB of server state per connection (vs ~50 KiB for a WebSocket,
  which must track frame buffers, masking, ping/pong). [1][2]
- **Throughput:** a single Node 22 process "comfortably handles 5,000–10,000 idle SSE
  connections on a 4 vCPU box," bounded by file descriptors + per-connection memory
  (~10 KB). Hundreds is well within one process. [2]
- **Ops:** streams pass through CDNs/proxies/load balancers without special config;
  reconnection is built in via `Last-Event-ID` and needs **no sticky sessions**. [1][3]
- **Browser caveat (not a blocker for us):** over HTTP/1.1 the browser allows only
  **6 connections per domain**, and an `EventSource` counts against it. This only
  bites when _one_ client opens many SSE streams. Here each browser holds **one**
  presence stream per lesson view, so HTTP/1.1 is fine; HTTP/2 multiplexing (~100
  streams/connection) only matters if we later open several streams per page. [4][5]

### C. WebSockets

- **Pros:** bidirectional; native fit if presence later becomes interactive (chat).
- **Cons:** needs a custom server (we don't have one), ~10× per-connection memory,
  connection affinity / stickier scaling. Overkill for one-way presence. [1][2]
- **Verdict:** rejected for v1; revisit only if presence becomes two-way.

### D. Managed realtime (Ably / Pusher / Liveblocks / Supabase Realtime)

- **Pros:** native **presence primitives** — `enter`/`leave`/`update` member events
  out of the box, with member data. [6][7]
- **Cons:** external dependency + cost + student data leaving our infra. Billing is
  **per message**, and presence fans out in an **n² pattern** (members × subscribers
  on a channel), so hundreds of concurrent members on a hot lesson gets expensive
  fast. [6]
- **Verdict:** the pragmatic escape hatch if we ever need true multi-region scale
  without running our own pub/sub — but not for v1.

---

## 4. Chosen design

**SSE + an in-memory presence registry + a per-lesson event fan-out**, opt-in and
anonymized. No new dependencies, no schema migration.

### 4.1 Source of truth: in-memory registry (server-only)

A module-level structure in a `.server.ts` file (lives for the life of the process):

```
presence: Map<lessonId, Map<presenceKey, Entry>>
Entry = { avatarSeed: string; lastSeen: number; connections: number }
```

- `presenceKey` is a **per-session anonymized token** (not the userId), so we never
  expose identity. `avatarSeed` derives a stable dicebear avatar for that
  session+lesson, giving distinct-but-anonymous avatars.
- Presence is **ephemeral** — losing it on deploy/restart is acceptable (clients
  reconnect and re-register within one heartbeat). This is why we deliberately do
  **not** persist heartbeats to SQLite (which would serialize writes and add load for
  data we don't need to keep).

### 4.2 Heartbeat + TTL (liveness)

- The **SSE connection itself is the primary liveness signal**: on
  `request.signal` `abort` (tab close / navigation) we decrement/remove the entry
  and broadcast.
- A **TTL sweep** is the backup for ungraceful drops (crashed tab, dead network):
  entries older than `PRESENCE_TTL` (≈ 2× the keep-alive interval, for clock skew)
  are pruned. [8][9]
- A **keep-alive comment frame** (`: ping\n\n`) is sent every **~25s** to stop idle
  proxies from killing the stream and to refresh `lastSeen`. [2]
- If we add an explicit client ping later, **jitter the refresh to 75–100% of the
  TTL** to avoid a thundering herd. [8]

### 4.3 API — SSE resource route

`GET /api/lessons/:lessonId/presence` (resource route, no default export):

- Resolves the current user; **enrollment-gated** (only people with access to the
  lesson can subscribe), consistent with existing lesson authorization.
- Registers the viewer **only if they have opted in**; non-opted-in viewers still
  receive the stream (they can _see_ the count) but are not counted/shown.
- Returns:
  ```
  new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",   // disable nginx buffering [2]
    },
  })
  ```
- **No compression** on this route (buffering makes SSE look broken). [2]
- Emits a `presence` event with `{ count, avatars: string[] }` whenever the
  lesson's membership changes, plus an initial snapshot on connect.

### 4.4 Fan-out

A per-lesson `EventEmitter` (in the same `.server.ts` module): each open SSE handler
subscribes; membership changes `emit` once and every subscriber writes the new
snapshot to its stream. This is the **single-process** fan-out; §7 swaps the emitter
for Redis pub/sub when we go multi-instance. [2]

### 4.5 Client integration

- In the lesson viewer (`app/routes/courses.$slug.lessons.$lessonId.tsx`), a small
  `<LessonPresence lessonId pptIn>` component opens an `EventSource` to the route and
  renders the avatar cluster + "N watching now" (reusing the dashboard's overlapping
  avatar-stack styling).
- An **opt-in toggle** ("Appear to others as watching") controls whether we register
  this session as present. Default **off**. Persisted as a lightweight user setting
  (see Open Questions) so the choice sticks.
- Close the `EventSource` on unmount so the server sees the disconnect promptly.

---

## 5. Privacy model

- **Opt-in, off by default.** You are never shown to others unless you turn it on.
- **Anonymized.** Others see an avatar derived from a per-session token, never your
  name, id, or profile link. Even opted-in, you are not personally identifiable.
- **Symmetry not required:** you can watch the count without appearing yourself.
- **No persistence:** presence exists only in memory while you're connected; nothing
  about "who watched alongside whom" is ever written to the database.

---

## 6. Risks & mitigations

| Risk                                             | Mitigation                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Ungraceful disconnects leave "ghost" viewers     | TTL sweep prunes stale entries (≈2× keep-alive) [8]                                                    |
| Proxy/CDN buffers the stream → looks frozen      | `X-Accel-Buffering: no`, no compression, 25s keep-alive [2]                                            |
| Thundering-herd refreshes at hundreds of viewers | Jitter refresh to 75–100% of TTL [8]                                                                   |
| Restart drops all presence                       | Acceptable (ephemeral); clients reconnect within one heartbeat                                         |
| Multi-instance breaks in-process fan-out         | Documented Redis pub/sub seam (§7) [2]                                                                 |
| Low opt-in → indicator looks empty               | Show count of _all_ viewers (anonymous) even if avatars are opt-in only — revisit if numbers feel dead |

---

## 7. Scaling path (single-node → hundreds+ → multi-instance)

1. **Now (single process):** in-memory registry + per-lesson `EventEmitter`. Handles
   thousands of connections per box; hundreds per lesson is comfortable. [2]
2. **Vertical headroom:** raise the file-descriptor `ulimit`; watch RSS (~10 KB/conn). [2]
3. **Horizontal (>1 instance):** replace the `EventEmitter` with **Redis pub/sub** —
   each instance subscribes to a `lesson:{id}:presence` channel and forwards to its
   local SSE clients; presence membership moves to Redis keys with TTL (heartbeat
   refresh). At-most-once delivery is fine for ephemeral presence. [2][8]
4. **Escape hatch:** if we'd rather not run pub/sub, adopt a managed presence service
   (Ably/Pusher) — accepting per-message, n²-scaling cost. [6][7]

The code seam is deliberately small: the registry + emitter live behind one
`presence.server.ts` module, so steps 1→3 swap that module's internals without
touching the route or the UI.

---

## 8. Implementation outline (proposed phases)

- **Phase 1 — Walking skeleton:** `presence.server.ts` registry + per-lesson emitter;
  SSE resource route emitting `{ count }`; a count-only indicator in the lesson
  viewer; opt-in toggle (default off). Manual verification with two browsers.
- **Phase 2 — Anonymized avatars:** add per-session `avatarSeed`, emit `avatars[]`,
  render the avatar cluster; TTL sweep + keep-alive frames.
- **Phase 3 — Hardening:** enrollment gating, reconnection/`Last-Event-ID`, jittered
  refresh, proxy headers, and load-test a few hundred simulated connections.
- **Phase 4 (deferred):** Redis pub/sub seam for multi-instance (only when we
  actually run >1 instance).

No schema changes are required for Phases 1–3 (presence is in-memory). The opt-in
preference is the only thing that may need persistence (see Open Questions).

---

## 9. Open questions

1. **Where does the opt-in preference live?** A new `users` column / settings row, or
   a cookie/localStorage per device? (Cookie is simplest and avoids a migration; a
   column makes it cross-device.)
2. **Avatar style:** fully generated/anonymous avatars, or the user's _real_ avatar
   shown without a name? (Latter is warmer but semi-identifying.)
3. **Count semantics with low opt-in:** count _all_ current viewers anonymously, or
   only opted-in ones? (Counting all keeps the number lively.)
4. **Does presence ever need to be two-way** (reactions, "study together")? If yes
   soon, reconsider WebSockets now to avoid a second migration.

---

## Sources

1. [WebSocket vs Server-Sent Events — Key Differences (GetStream)](https://getstream.io/blog/websocket-sse/)
2. [Node.js Server-Sent Events (SSE) in 2026: The Production Guide (HireNodeJS)](https://www.hirenodejs.com/blog/nodejs-server-sent-events-sse-2026)
3. [Server-Sent Events Beat WebSockets for 95% of Real-Time Apps (dev.to)](https://dev.to/polliog/server-sent-events-beat-websockets-for-95-of-real-time-apps-heres-why-a4l)
4. [The Pitfalls of EventSource over HTTP/1.1 (text/plain)](https://textslashplain.com/2019/12/04/the-pitfalls-of-eventsource-over-http-1-1/)
5. [EventSource — MDN](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
6. [Ably Pub/Sub | Presence](https://ably.com/docs/presence-occupancy/presence)
7. [Pusher Channels Docs | Presence channels](https://pusher.com/docs/channels/using_channels/presence-channels/)
8. [Redis-Powered User Session Tracking with Heartbeat-Based Expiration (Tilt Engineering)](https://medium.com/tilt-engineering/redis-powered-user-session-tracking-with-heartbeat-based-expiration-c7308420489f)
9. [Understanding the Heartbeat Pattern in Distributed Systems (Medium)](https://medium.com/@a.mousavi/understanding-the-heartbeat-pattern-in-distributed-systems-5d2264bbfda6)
10. [Using server-sent events — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
11. [Scaling Server-Sent Events: 28,000+ concurrent connections (Pranshu Raj)](https://blog.pranshu-raj.me/posts/exploring-sse/)
