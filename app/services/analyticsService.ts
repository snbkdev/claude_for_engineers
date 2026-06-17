import { inArray, and, gt, gte, lt, sum, type SQL } from "drizzle-orm";
import { db } from "~/db";
import { purchases } from "~/db/schema";

// ─── Analytics Service ───
// Aggregates revenue from purchases, scoped by a list of course IDs. The service
// is auth-agnostic: callers (routes) decide which course IDs are in scope
// (an instructor's own courses, or every course for an admin). Synchronous
// (better-sqlite3). Functions with multiple same-typed params take a single
// object param.
//
// Counting semantics: only purchases with pricePaid > 0 count toward revenue
// ($0 / free purchases are excluded). An optional from/to range filters on
// purchases.createdAt — `from` is an inclusive lower bound, `to` an exclusive
// upper bound (both ISO timestamps). Omitting both yields the all-time figure.

export interface RevenueSummary {
  totalRevenue: number; // cents
}

export function getRevenueSummary(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
}): RevenueSummary {
  if (opts.courseIds.length === 0) {
    return { totalRevenue: 0 };
  }

  const conditions: SQL[] = [
    inArray(purchases.courseId, opts.courseIds),
    gt(purchases.pricePaid, 0),
  ];
  if (opts.from) conditions.push(gte(purchases.createdAt, opts.from));
  if (opts.to) conditions.push(lt(purchases.createdAt, opts.to));

  const row = db
    .select({ total: sum(purchases.pricePaid) })
    .from(purchases)
    .where(and(...conditions))
    .get();

  return { totalRevenue: Number(row?.total ?? 0) };
}
