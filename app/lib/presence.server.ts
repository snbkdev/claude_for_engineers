import { EventEmitter } from "node:events";

// ─── Presence Registry ───
//
// REUSABLE ASSET (see plans/live-presence-prototype.md). An in-memory,
// per-process presence registry + per-room event fan-out, used by the live
// presence indicator (see plans/live-presence-indicator-research.md §4).
//
// It is intentionally framework-agnostic and transport-agnostic: it knows
// nothing about SSE, React Router, or HTTP. A transport (the SSE route) calls
// `join`/`touch`/`leave` on connect/heartbeat/disconnect and `subscribe`s to
// push snapshots to clients. Presence is ephemeral — losing it on restart is
// acceptable.
//
// SCALING SEAM: to go multi-instance, swap the module-internal `rooms` Map +
// `emitter` for a shared store + Redis pub/sub. The exported surface
// (`join`/`touch`/`leave`/`subscribe`/`getSnapshot`) stays the same.

/** Entries older than this (no heartbeat) are pruned by `sweep`. */
export const PRESENCE_TTL_MS = 60_000;
/** Suggested keep-alive / heartbeat interval for transports (TTL ≈ 2×). */
export const KEEPALIVE_MS = 25_000;
/** How many avatar seeds a snapshot carries for display (count is uncapped). */
export const MAX_AVATARS = 12;

export interface PresenceSnapshot {
  /** Distinct present members (keys), not connections. */
  count: number;
  /** Up to MAX_AVATARS anonymized seeds, for rendering an avatar cluster. */
  avatarSeeds: string[];
}

interface Entry {
  avatarSeed: string;
  lastSeen: number;
  /** Open connections for this key (multiple tabs = same member). */
  connections: number;
}

const rooms = new Map<string, Map<string, Entry>>();
const emitter = new EventEmitter();
// Many SSE connections subscribe to the same room; lift the listener cap.
emitter.setMaxListeners(0);

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function roomMap(roomId: string): Map<string, Entry> {
  let m = rooms.get(roomId);
  if (!m) {
    m = new Map();
    rooms.set(roomId, m);
  }
  return m;
}

export function getSnapshot(roomId: string): PresenceSnapshot {
  const m = rooms.get(roomId);
  if (!m || m.size === 0) return { count: 0, avatarSeeds: [] };
  const avatarSeeds: string[] = [];
  for (const entry of m.values()) {
    if (avatarSeeds.length >= MAX_AVATARS) break;
    avatarSeeds.push(entry.avatarSeed);
  }
  return { count: m.size, avatarSeeds };
}

function notify(roomId: string): void {
  emitter.emit(roomId, getSnapshot(roomId));
}

/** Subscribe to snapshot changes for a room. Returns an unsubscribe fn. */
export function subscribe(
  roomId: string,
  listener: (snapshot: PresenceSnapshot) => void
): () => void {
  emitter.on(roomId, listener);
  return () => emitter.off(roomId, listener);
}

/**
 * Register a present member (one connection). Returns a `leave` fn that is
 * safe to call once; calling it more than once is a no-op.
 */
export function join(opts: {
  roomId: string;
  key: string;
  avatarSeed: string;
  now?: number;
}): () => void {
  const now = opts.now ?? Date.now();
  const m = roomMap(opts.roomId);
  const existing = m.get(opts.key);
  if (existing) {
    existing.connections += 1;
    existing.lastSeen = now;
  } else {
    m.set(opts.key, {
      avatarSeed: opts.avatarSeed,
      lastSeen: now,
      connections: 1,
    });
  }
  notify(opts.roomId);

  let left = false;
  return () => {
    if (left) return;
    left = true;
    leave({ roomId: opts.roomId, key: opts.key });
  };
}

/** Refresh a member's liveness (called on each heartbeat). */
export function touch(opts: {
  roomId: string;
  key: string;
  now?: number;
}): void {
  const entry = rooms.get(opts.roomId)?.get(opts.key);
  if (entry) entry.lastSeen = opts.now ?? Date.now();
}

function leave(opts: { roomId: string; key: string }): void {
  const m = rooms.get(opts.roomId);
  const entry = m?.get(opts.key);
  if (!m || !entry) return;
  entry.connections -= 1;
  if (entry.connections <= 0) {
    m.delete(opts.key);
    if (m.size === 0) rooms.delete(opts.roomId);
  }
  notify(opts.roomId);
}

/**
 * Prune entries that haven't been seen within the TTL (the backup for
 * ungraceful disconnects, where `leave` never fired). Notifies affected rooms
 * and returns their ids.
 */
export function sweep(now: number = Date.now()): string[] {
  const affected: string[] = [];
  for (const [roomId, m] of rooms) {
    let changed = false;
    for (const [key, entry] of m) {
      if (now - entry.lastSeen > PRESENCE_TTL_MS) {
        m.delete(key);
        changed = true;
      }
    }
    if (changed) {
      affected.push(roomId);
      if (m.size === 0) rooms.delete(roomId);
      notify(roomId);
    }
  }
  return affected;
}

/** Start the background TTL sweep (idempotent). Call once from a transport. */
export function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweep(), KEEPALIVE_MS);
  // Don't keep the process alive just for the sweep.
  sweepTimer.unref?.();
}

/** Test-only: wipe all state and listeners. */
export function __resetPresence(): void {
  rooms.clear();
  emitter.removeAllListeners();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
