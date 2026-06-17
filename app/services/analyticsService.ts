import { inArray, and, gt, gte, lt, isNull, count, type SQL } from "drizzle-orm";
import { db } from "~/db";
import { purchases, coupons, courses } from "~/db/schema";

// ─── Analytics Service ───
// Aggregates revenue from purchases, scoped by a list of course IDs. The service
// is auth-agnostic: callers (routes) decide which course IDs are in scope
// (an instructor's own courses, or every course for an admin). Synchronous
// (better-sqlite3). Functions with multiple same-typed params take a single
// object param.
//
// Counting semantics: only purchases with pricePaid > 0 count toward revenue,
// sales, AOV, and seats ($0 / free purchases are excluded). An optional from/to
// range filters on purchases.createdAt — `from` is an inclusive lower bound,
// `to` an exclusive upper bound (both ISO timestamps). Omitting both yields the
// all-time figure. A team/bulk purchase is one transaction but sells N seats
// (its coupon count); an individual purchase is one transaction and one seat.

export interface RevenueSummary {
  totalRevenue: number; // cents
  transactionCount: number;
  averageOrderValue: number; // cents (revenue / transactions; 0 when no txns)
  seatsSold: number;
}

export function getRevenueSummary(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
}): RevenueSummary {
  if (opts.courseIds.length === 0) {
    return {
      totalRevenue: 0,
      transactionCount: 0,
      averageOrderValue: 0,
      seatsSold: 0,
    };
  }

  const conditions: SQL[] = [
    inArray(purchases.courseId, opts.courseIds),
    gt(purchases.pricePaid, 0),
  ];
  if (opts.from) conditions.push(gte(purchases.createdAt, opts.from));
  if (opts.to) conditions.push(lt(purchases.createdAt, opts.to));

  const rows = db
    .select({ id: purchases.id, pricePaid: purchases.pricePaid })
    .from(purchases)
    .where(and(...conditions))
    .all();

  const totalRevenue = rows.reduce((sum, r) => sum + r.pricePaid, 0);
  const transactionCount = rows.length;
  const averageOrderValue =
    transactionCount === 0 ? 0 : totalRevenue / transactionCount;

  // Seats: a purchase with coupons sells one seat per coupon; a purchase with
  // none (an individual sale) sells one seat.
  let seatsSold = 0;
  if (rows.length > 0) {
    const couponCounts = db
      .select({ purchaseId: coupons.purchaseId, seats: count() })
      .from(coupons)
      .where(
        inArray(
          coupons.purchaseId,
          rows.map((r) => r.id)
        )
      )
      .groupBy(coupons.purchaseId)
      .all();
    const seatsByPurchase = new Map(
      couponCounts.map((c) => [c.purchaseId, Number(c.seats)])
    );
    seatsSold = rows.reduce(
      (sum, r) => sum + (seatsByPurchase.get(r.id) ?? 1),
      0
    );
  }

  return { totalRevenue, transactionCount, averageOrderValue, seatsSold };
}

export interface CourseRevenueRow {
  courseId: number;
  title: string;
  revenue: number; // cents
  transactions: number;
  seats: number;
}

// Per-course breakdown for the in-scope courses (every in-scope course is
// included, even with no sales). Same counting semantics as getRevenueSummary;
// rows are returned sorted by revenue descending.
export function getRevenueByCourse(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
}): CourseRevenueRow[] {
  if (opts.courseIds.length === 0) {
    return [];
  }

  const courseRows = db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(inArray(courses.id, opts.courseIds))
    .all();

  const rows = courseRows.map((course) => {
    const summary = getRevenueSummary({
      courseIds: [course.id],
      from: opts.from,
      to: opts.to,
    });
    return {
      courseId: course.id,
      title: course.title,
      revenue: summary.totalRevenue,
      transactions: summary.transactionCount,
      seats: summary.seatsSold,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue);
  return rows;
}

// Outstanding seats are a current-state snapshot (not period-scoped): coupons
// for the in-scope courses that have been sold but not yet redeemed.
export function getOutstandingSeats(opts: { courseIds: number[] }): number {
  if (opts.courseIds.length === 0) {
    return 0;
  }

  const row = db
    .select({ seats: count() })
    .from(coupons)
    .where(
      and(
        inArray(coupons.courseId, opts.courseIds),
        isNull(coupons.redeemedByUserId)
      )
    )
    .get();

  return Number(row?.seats ?? 0);
}
