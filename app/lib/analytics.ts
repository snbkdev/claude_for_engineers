// ─── Analytics helpers (pure, no DB) ───
// Date-range resolution for the revenue analytics dashboard. Pure and
// deterministic (a `now` can be injected) so it is unit-testable in isolation.
// All boundaries are computed in UTC.

export type RangePreset = "7d" | "30d" | "90d" | "all";

export const DEFAULT_PRESET: RangePreset = "30d";

const PRESET_DAYS: Record<Exclude<RangePreset, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export interface ResolvedRange {
  /** The active preset, or "custom" when from/to dates were supplied. */
  preset: RangePreset | "custom";
  /** Inclusive start date as "YYYY-MM-DD" (for date inputs / display), or null. */
  fromDate: string | null;
  /** Inclusive end date as "YYYY-MM-DD" (for date inputs / display), or null. */
  toDate: string | null;
  /** Inclusive lower bound as an ISO timestamp for querying, or null (unbounded). */
  from: string | null;
  /** Exclusive upper bound as an ISO timestamp for querying, or null (unbounded). */
  to: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isPreset(value: string | null): value is RangePreset {
  return value === "7d" || value === "30d" || value === "90d" || value === "all";
}

function resolvePreset(preset: RangePreset, now: Date): ResolvedRange {
  if (preset === "all") {
    return { preset, fromDate: null, toDate: null, from: null, to: null };
  }
  // Exclusive upper bound = start of tomorrow (UTC), so today is fully included.
  const toExclusive = addDays(startOfUtcDay(now), 1);
  const from = addDays(toExclusive, -PRESET_DAYS[preset]);
  return {
    preset,
    fromDate: toDateString(from),
    toDate: toDateString(startOfUtcDay(now)),
    from: from.toISOString(),
    to: toExclusive.toISOString(),
  };
}

/**
 * Resolve the analytics date range from URL search params.
 *
 * - `?from=YYYY-MM-DD&to=YYYY-MM-DD` (either bound optional) → a custom range,
 *   with the `to` day fully included (exclusive upper bound = next day).
 * - `?preset=7d|30d|90d|all` → a rolling window ending today (or unbounded).
 * - Neither → the default preset (last 30 days).
 *
 * Invalid custom dates and unknown presets fall back to the default preset.
 */
export function resolveRange(
  searchParams: URLSearchParams,
  now: Date = new Date()
): ResolvedRange {
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  const fromValid = rawFrom && DATE_RE.test(rawFrom) ? rawFrom : null;
  const toValid = rawTo && DATE_RE.test(rawTo) ? rawTo : null;

  if (fromValid || toValid) {
    return {
      preset: "custom",
      fromDate: fromValid,
      toDate: toValid,
      from: fromValid ? `${fromValid}T00:00:00.000Z` : null,
      // Exclusive upper bound = start of the day after `to`.
      to: toValid
        ? addDays(new Date(`${toValid}T00:00:00.000Z`), 1).toISOString()
        : null,
    };
  }

  const presetParam = searchParams.get("preset");
  const preset = isPreset(presetParam) ? presetParam : DEFAULT_PRESET;
  return resolvePreset(preset, now);
}
