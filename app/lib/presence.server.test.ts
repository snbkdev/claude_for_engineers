import { describe, it, expect, beforeEach } from "vitest";
import {
  join,
  touch,
  sweep,
  subscribe,
  getSnapshot,
  __resetPresence,
  PRESENCE_TTL_MS,
  MAX_AVATARS,
  type PresenceSnapshot,
} from "./presence.server";

beforeEach(() => {
  __resetPresence();
});

describe("presence registry", () => {
  it("counts a joined member and clears on leave", () => {
    const leave = join({ roomId: "r1", key: "k1", avatarSeed: "a" });
    expect(getSnapshot("r1")).toEqual({ count: 1, avatarSeeds: ["a"] });
    leave();
    expect(getSnapshot("r1")).toEqual({ count: 0, avatarSeeds: [] });
  });

  it("counts distinct keys, not connections", () => {
    join({ roomId: "r1", key: "k1", avatarSeed: "a" });
    const leaveSecondTab = join({ roomId: "r1", key: "k1", avatarSeed: "a" });
    join({ roomId: "r1", key: "k2", avatarSeed: "b" });
    // two distinct keys despite three connections
    expect(getSnapshot("r1").count).toBe(2);
    // closing one of k1's two tabs keeps k1 present
    leaveSecondTab();
    expect(getSnapshot("r1").count).toBe(2);
  });

  it("isolates rooms from each other", () => {
    join({ roomId: "r1", key: "k1", avatarSeed: "a" });
    expect(getSnapshot("r2").count).toBe(0);
  });

  it("notifies subscribers on join and leave", () => {
    const seen: PresenceSnapshot[] = [];
    const unsub = subscribe("r1", (s) => seen.push(s));
    const leave = join({ roomId: "r1", key: "k1", avatarSeed: "a" });
    leave();
    unsub();
    expect(seen.map((s) => s.count)).toEqual([1, 0]);
  });

  it("prunes stale entries past the TTL but keeps recently-touched ones", () => {
    const t0 = 1_000_000;
    join({ roomId: "r1", key: "stale", avatarSeed: "a", now: t0 });
    join({ roomId: "r1", key: "fresh", avatarSeed: "b", now: t0 });
    // fresh heartbeats just before the sweep
    const sweepAt = t0 + PRESENCE_TTL_MS + 1;
    touch({ roomId: "r1", key: "fresh", now: sweepAt - 1 });
    const affected = sweep(sweepAt);
    expect(affected).toContain("r1");
    expect(getSnapshot("r1").count).toBe(1);
    expect(getSnapshot("r1").avatarSeeds).toEqual(["b"]);
  });

  it("caps avatarSeeds for display but not the count", () => {
    for (let i = 0; i < MAX_AVATARS + 5; i++) {
      join({ roomId: "r1", key: `k${i}`, avatarSeed: `seed${i}` });
    }
    const snap = getSnapshot("r1");
    expect(snap.count).toBe(MAX_AVATARS + 5);
    expect(snap.avatarSeeds).toHaveLength(MAX_AVATARS);
  });
});
