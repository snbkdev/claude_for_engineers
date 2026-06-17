import { inArray, and, gt, sum } from "drizzle-orm";
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
// ($0 / free purchases are excluded).

export interface RevenueSummary {
  totalRevenue: number; // cents
}

export function getRevenueSummary(opts: {
  courseIds: number[];
}): RevenueSummary {
  if (opts.courseIds.length === 0) {
    return { totalRevenue: 0 };
  }

  const row = db
    .select({ total: sum(purchases.pricePaid) })
    .from(purchases)
    .where(
      and(
        inArray(purchases.courseId, opts.courseIds),
        gt(purchases.pricePaid, 0)
      )
    )
    .get();

  return { totalRevenue: Number(row?.total ?? 0) };
}
