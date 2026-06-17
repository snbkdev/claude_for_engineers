import { describe, it, expect } from "vitest";
import { resolveRange } from "./analytics";

// Fixed "now" so preset windows are deterministic. 2026-06-17 (UTC).
const NOW = new Date("2026-06-17T12:30:00.000Z");

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("resolveRange", () => {
  it("defaults to the last 30 days when no params are given", () => {
    const r = resolveRange(params(""), NOW);
    expect(r.preset).toBe("30d");
    // Exclusive upper bound = start of tomorrow; window = 30 full days incl. today.
    expect(r.from).toBe("2026-05-19T00:00:00.000Z");
    expect(r.to).toBe("2026-06-18T00:00:00.000Z");
    expect(r.fromDate).toBe("2026-05-19");
    expect(r.toDate).toBe("2026-06-17");
  });

  it("resolves the 7-day preset", () => {
    const r = resolveRange(params("preset=7d"), NOW);
    expect(r.preset).toBe("7d");
    expect(r.from).toBe("2026-06-11T00:00:00.000Z");
    expect(r.to).toBe("2026-06-18T00:00:00.000Z");
  });

  it("resolves the 90-day preset", () => {
    const r = resolveRange(params("preset=90d"), NOW);
    expect(r.preset).toBe("90d");
    expect(r.from).toBe("2026-03-20T00:00:00.000Z");
    expect(r.to).toBe("2026-06-18T00:00:00.000Z");
  });

  it("treats the all-time preset as unbounded", () => {
    const r = resolveRange(params("preset=all"), NOW);
    expect(r.preset).toBe("all");
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(r.fromDate).toBeNull();
    expect(r.toDate).toBeNull();
  });

  it("falls back to the default for an unknown preset", () => {
    const r = resolveRange(params("preset=bogus"), NOW);
    expect(r.preset).toBe("30d");
  });

  it("resolves a custom from–to range with the end day fully included", () => {
    const r = resolveRange(params("from=2026-01-01&to=2026-01-31"), NOW);
    expect(r.preset).toBe("custom");
    expect(r.fromDate).toBe("2026-01-01");
    expect(r.toDate).toBe("2026-01-31");
    expect(r.from).toBe("2026-01-01T00:00:00.000Z");
    // Exclusive upper bound = start of the day after `to`.
    expect(r.to).toBe("2026-02-01T00:00:00.000Z");
  });

  it("accepts a custom range with only a lower bound", () => {
    const r = resolveRange(params("from=2026-01-01"), NOW);
    expect(r.preset).toBe("custom");
    expect(r.from).toBe("2026-01-01T00:00:00.000Z");
    expect(r.to).toBeNull();
  });

  it("ignores malformed custom dates and falls back to the default", () => {
    const r = resolveRange(params("from=nonsense"), NOW);
    expect(r.preset).toBe("30d");
  });
});
