import { describe, it, expect } from "vitest";
import {
  resolveRange,
  selectGranularity,
  bucketPeriods,
  countryName,
} from "./analytics";

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

describe("selectGranularity", () => {
  function gran(fromDay: string, toDay: string) {
    return selectGranularity(
      `${fromDay}T00:00:00.000Z`,
      `${toDay}T00:00:00.000Z`
    );
  }

  it("is daily up to and including 31 days", () => {
    expect(gran("2026-01-01", "2026-02-01")).toBe("daily"); // 31 days
  });

  it("switches to weekly past 31 days", () => {
    expect(gran("2026-01-01", "2026-02-02")).toBe("weekly"); // 32 days
  });

  it("is weekly up to and including 92 days", () => {
    expect(gran("2026-01-01", "2026-04-03")).toBe("weekly"); // 92 days
  });

  it("switches to monthly past 92 days", () => {
    expect(gran("2026-01-01", "2026-04-04")).toBe("monthly"); // 93 days
  });
});

describe("bucketPeriods", () => {
  it("produces one daily bucket per day with end exclusive", () => {
    const buckets = bucketPeriods(
      "2026-06-01T00:00:00.000Z",
      "2026-06-04T00:00:00.000Z",
      "daily"
    );
    expect(buckets.map((b) => b.label)).toEqual(["Jun 1", "Jun 2", "Jun 3"]);
    expect(buckets[0].start).toBe("2026-06-01T00:00:00.000Z");
    expect(buckets[0].end).toBe("2026-06-02T00:00:00.000Z");
    expect(buckets[2].end).toBe("2026-06-04T00:00:00.000Z");
  });

  it("produces 7-day weekly buckets", () => {
    const buckets = bucketPeriods(
      "2026-06-01T00:00:00.000Z",
      "2026-06-22T00:00:00.000Z",
      "weekly"
    );
    expect(buckets).toHaveLength(3);
    expect(buckets.map((b) => b.start)).toEqual([
      "2026-06-01T00:00:00.000Z",
      "2026-06-08T00:00:00.000Z",
      "2026-06-15T00:00:00.000Z",
    ]);
  });

  it("produces calendar-month buckets", () => {
    const buckets = bucketPeriods(
      "2026-01-15T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
      "monthly"
    );
    expect(buckets.map((b) => b.label)).toEqual([
      "Jan 2026",
      "Feb 2026",
      "Mar 2026",
    ]);
    // First bucket snaps to the start of the month.
    expect(buckets[0].start).toBe("2026-01-01T00:00:00.000Z");
    expect(buckets[1].start).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("countryName", () => {
  it("maps a known ISO code to its full name", () => {
    expect(countryName("US")).toBe("United States");
    expect(countryName("GB")).toBe("United Kingdom");
  });

  it("is case-insensitive", () => {
    expect(countryName("us")).toBe("United States");
  });

  it("returns Unknown for a null/empty country", () => {
    expect(countryName(null)).toBe("Unknown");
    expect(countryName("")).toBe("Unknown");
  });

  it("returns Unknown for an unrecognized code", () => {
    expect(countryName("ZZ")).toBe("Unknown");
  });
});
