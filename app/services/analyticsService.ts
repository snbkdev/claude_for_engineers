import {
  inArray,
  and,
  eq,
  gt,
  gte,
  lt,
  isNull,
  count,
  type SQL,
} from "drizzle-orm";
import { db } from "~/db";
import { purchases, coupons, courses, enrollments, users } from "~/db/schema";
import {
  selectGranularity,
  bucketPeriods,
  countryName,
  type Granularity,
} from "~/lib/analytics";
import { getAverageRatingsForCourses } from "~/services/ratingService";

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

export interface TimeSeriesPoint {
  label: string;
  periodStart: string; // ISO timestamp
  revenue: number; // cents
  transactions: number;
}

// Revenue over time, bucketed into contiguous periods. When from/to are given,
// buckets span exactly that range (empty buckets render as zeros); when omitted
// (all-time), the range is derived from the data (earliest sale → last sale).
// Granularity is chosen automatically from the span unless one is passed.
export function getRevenueTimeSeries(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
  granularity?: Granularity;
}): TimeSeriesPoint[] {
  if (opts.courseIds.length === 0) {
    return [];
  }

  const conditions: SQL[] = [
    inArray(purchases.courseId, opts.courseIds),
    gt(purchases.pricePaid, 0),
  ];
  if (opts.from) conditions.push(gte(purchases.createdAt, opts.from));
  if (opts.to) conditions.push(lt(purchases.createdAt, opts.to));

  const rows = db
    .select({ pricePaid: purchases.pricePaid, createdAt: purchases.createdAt })
    .from(purchases)
    .where(and(...conditions))
    .all();

  // Resolve the effective range: explicit bounds win; otherwise derive from data.
  let from = opts.from ?? null;
  let to = opts.to ?? null;
  if ((from === null || to === null) && rows.length > 0) {
    const created = rows.map((r) => r.createdAt);
    if (from === null) {
      from = created.reduce((min, c) => (c < min ? c : min), created[0]);
    }
    if (to === null) {
      const max = created.reduce((m, c) => (c > m ? c : m), created[0]);
      const maxDate = new Date(max);
      to = new Date(
        Date.UTC(
          maxDate.getUTCFullYear(),
          maxDate.getUTCMonth(),
          maxDate.getUTCDate() + 1
        )
      ).toISOString();
    }
  }
  if (from === null || to === null) {
    return [];
  }

  const granularity = opts.granularity ?? selectGranularity(from, to);
  const buckets = bucketPeriods(from, to, granularity);

  return buckets.map((bucket) => {
    let revenue = 0;
    let transactions = 0;
    for (const row of rows) {
      if (row.createdAt >= bucket.start && row.createdAt < bucket.end) {
        revenue += row.pricePaid;
        transactions += 1;
      }
    }
    return {
      label: bucket.label,
      periodStart: bucket.start,
      revenue,
      transactions,
    };
  });
}

export interface CountryRevenueRow {
  country: string; // display name; "Unknown" for missing/unrecognized
  revenue: number; // cents
  transactions: number;
}

// Revenue grouped by buyer country (purchases.country). Rows group by resolved
// display name, so a null/unrecognized country collapses into a single "Unknown"
// row. Same counting semantics as getRevenueSummary; sorted by revenue desc.
export function getRevenueByCountry(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
}): CountryRevenueRow[] {
  if (opts.courseIds.length === 0) {
    return [];
  }

  const conditions: SQL[] = [
    inArray(purchases.courseId, opts.courseIds),
    gt(purchases.pricePaid, 0),
  ];
  if (opts.from) conditions.push(gte(purchases.createdAt, opts.from));
  if (opts.to) conditions.push(lt(purchases.createdAt, opts.to));

  const rows = db
    .select({ country: purchases.country, pricePaid: purchases.pricePaid })
    .from(purchases)
    .where(and(...conditions))
    .all();

  const byCountry = new Map<
    string,
    { revenue: number; transactions: number }
  >();
  for (const row of rows) {
    const name = countryName(row.country);
    const entry = byCountry.get(name) ?? { revenue: 0, transactions: 0 };
    entry.revenue += row.pricePaid;
    entry.transactions += 1;
    byCountry.set(name, entry);
  }

  const result = [...byCountry.entries()].map(([country, v]) => ({
    country,
    revenue: v.revenue,
    transactions: v.transactions,
  }));
  result.sort((a, b) => b.revenue - a.revenue);
  return result;
}

// Total enrollments across the in-scope courses, optionally filtered to a
// period on enrollments.enrolledAt (inclusive `from`, exclusive `to`). Unlike
// revenue, every enrollment counts (free enrollments included).
export function getEnrollmentCount(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
}): number {
  if (opts.courseIds.length === 0) {
    return 0;
  }

  const conditions: SQL[] = [inArray(enrollments.courseId, opts.courseIds)];
  if (opts.from) conditions.push(gte(enrollments.enrolledAt, opts.from));
  if (opts.to) conditions.push(lt(enrollments.enrolledAt, opts.to));

  const row = db
    .select({ total: count() })
    .from(enrollments)
    .where(and(...conditions))
    .get();

  return Number(row?.total ?? 0);
}

export interface TopCourse {
  courseId: number;
  title: string;
  revenue: number; // cents
}

// The single highest-earning in-scope course for the period, or null when no
// course has any revenue. Reuses getRevenueByCourse (sorted by revenue desc) so
// the counting semantics stay identical to the per-course breakdown.
export function getTopEarningCourse(opts: {
  courseIds: number[];
  from?: string | null;
  to?: string | null;
}): TopCourse | null {
  const top = getRevenueByCourse(opts)[0];
  if (!top || top.revenue <= 0) {
    return null;
  }
  return { courseId: top.courseId, title: top.title, revenue: top.revenue };
}

export interface CourseBreakdownRow {
  courseId: number;
  title: string;
  instructorId: number;
  instructorName: string;
  listPrice: number; // cents
  revenue: number; // cents
  sales: number;
  enrollments: number;
  averageRating: number | null;
  ratingCount: number;
}

// Per-course breakdown for the in-scope courses, optionally narrowed to a
// single instructor. Every matching course is included even with no sales.
// Same revenue counting semantics as getRevenueSummary; rows sorted by
// revenue descending.
export function getCourseBreakdown(opts: {
  courseIds: number[];
  instructorId?: number | null;
  from?: string | null;
  to?: string | null;
}): CourseBreakdownRow[] {
  if (opts.courseIds.length === 0) {
    return [];
  }

  const conditions: SQL[] = [inArray(courses.id, opts.courseIds)];
  if (opts.instructorId) {
    conditions.push(eq(courses.instructorId, opts.instructorId));
  }

  const courseRows = db
    .select({
      id: courses.id,
      title: courses.title,
      instructorId: courses.instructorId,
      instructorName: users.name,
      price: courses.price,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(and(...conditions))
    .all();

  if (courseRows.length === 0) {
    return [];
  }

  const ratings = getAverageRatingsForCourses(courseRows.map((c) => c.id));

  const rows = courseRows.map((course) => {
    const summary = getRevenueSummary({
      courseIds: [course.id],
      from: opts.from,
      to: opts.to,
    });
    const enrollmentCount = getEnrollmentCount({
      courseIds: [course.id],
      from: opts.from,
      to: opts.to,
    });
    const rating = ratings.get(course.id);
    return {
      courseId: course.id,
      title: course.title,
      instructorId: course.instructorId,
      instructorName: course.instructorName,
      listPrice: course.price,
      revenue: summary.totalRevenue,
      sales: summary.transactionCount,
      enrollments: enrollmentCount,
      averageRating: rating?.average ?? null,
      ratingCount: rating?.count ?? 0,
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
