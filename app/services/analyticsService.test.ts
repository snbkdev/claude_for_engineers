import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getRevenueSummary,
  getOutstandingSeats,
  getRevenueByCourse,
  getRevenueTimeSeries,
  getRevenueByCountry,
  getEnrollmentCount,
  getTopEarningCourse,
} from "./analyticsService";

function addEnrollment(opts: { courseId: number; enrolledAt?: string }) {
  return testDb
    .insert(schema.enrollments)
    .values({
      userId: base.user.id,
      courseId: opts.courseId,
      ...(opts.enrolledAt ? { enrolledAt: opts.enrolledAt } : {}),
    })
    .returning()
    .get();
}

function addPurchase(opts: {
  courseId: number;
  pricePaid: number;
  country?: string | null;
  createdAt?: string;
}) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: opts.courseId,
      pricePaid: opts.pricePaid,
      country: "country" in opts ? opts.country : "US",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning()
    .get();
}

// A team/bulk purchase: one purchase row + `seats` coupons referencing it.
// `redeemed` of them are marked consumed.
function addTeamPurchase(opts: {
  courseId: number;
  pricePaid: number;
  seats: number;
  redeemed?: number;
  createdAt?: string;
}) {
  const purchase = addPurchase({
    courseId: opts.courseId,
    pricePaid: opts.pricePaid,
    createdAt: opts.createdAt,
  });
  const team = testDb.insert(schema.teams).values({}).returning().get();
  for (let i = 0; i < opts.seats; i++) {
    const redeemed = i < (opts.redeemed ?? 0);
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: opts.courseId,
        code: `coupon-${purchase.id}-${i}`,
        purchaseId: purchase.id,
        redeemedByUserId: redeemed ? base.user.id : null,
        redeemedAt: redeemed ? new Date().toISOString() : null,
      })
      .run();
  }
  return purchase;
}

function addCourse(slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${slug}`,
      slug,
      description: "Another course",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getRevenueSummary", () => {
    it("sums pricePaid across purchases for the in-scope courses", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: base.course.id, pricePaid: 2500 });

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.totalRevenue).toBe(7499);
    });

    it("excludes $0 / free purchases from revenue", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: base.course.id, pricePaid: 0 });

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.totalRevenue).toBe(4999);
    });

    it("only counts purchases for courses in scope", () => {
      const other = addCourse("other-course");
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: other.id, pricePaid: 9999 });

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.totalRevenue).toBe(4999);
    });

    it("sums across multiple in-scope courses", () => {
      const other = addCourse("other-course");
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: other.id, pricePaid: 9999 });

      const summary = getRevenueSummary({
        courseIds: [base.course.id, other.id],
      });

      expect(summary.totalRevenue).toBe(14998);
    });

    it("returns 0 when the scope has no courses", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });

      expect(getRevenueSummary({ courseIds: [] }).totalRevenue).toBe(0);
    });

    it("returns 0 when there are no purchases", () => {
      expect(
        getRevenueSummary({ courseIds: [base.course.id] }).totalRevenue
      ).toBe(0);
    });

    it("filters by date range (from inclusive, to exclusive)", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-01-10T00:00:00.000Z", // before range
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-02-01T00:00:00.000Z", // inclusive lower bound
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 4000,
        createdAt: "2026-02-15T12:00:00.000Z", // inside range
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 8000,
        createdAt: "2026-03-01T00:00:00.000Z", // exclusive upper bound — excluded
      });

      const summary = getRevenueSummary({
        courseIds: [base.course.id],
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-03-01T00:00:00.000Z",
      });

      expect(summary.totalRevenue).toBe(6000);
    });

    it("treats an omitted range as all-time", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2020-01-01T00:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-06-01T00:00:00.000Z",
      });

      expect(
        getRevenueSummary({ courseIds: [base.course.id] }).totalRevenue
      ).toBe(3000);
    });

    it("counts transactions and computes average order value", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: base.course.id, pricePaid: 2500 });

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.transactionCount).toBe(2);
      expect(summary.averageOrderValue).toBe((4999 + 2500) / 2);
    });

    it("excludes $0 purchases from transactions and AOV", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 4000 });
      addPurchase({ courseId: base.course.id, pricePaid: 0 });

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.transactionCount).toBe(1);
      expect(summary.averageOrderValue).toBe(4000);
    });

    it("reports zero transactions and AOV when there are no sales", () => {
      const summary = getRevenueSummary({ courseIds: [base.course.id] });
      expect(summary.transactionCount).toBe(0);
      expect(summary.averageOrderValue).toBe(0);
    });

    it("counts one seat per individual purchase", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: base.course.id, pricePaid: 2500 });

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.seatsSold).toBe(2);
      expect(summary.transactionCount).toBe(2);
    });

    it("counts a team purchase as one transaction but N seats", () => {
      addTeamPurchase({ courseId: base.course.id, pricePaid: 30000, seats: 3 });
      addPurchase({ courseId: base.course.id, pricePaid: 4999 }); // individual

      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      expect(summary.transactionCount).toBe(2);
      expect(summary.seatsSold).toBe(4); // 3 team seats + 1 individual
    });
  });

  describe("getRevenueByCourse", () => {
    it("returns one row per in-scope course, sorted by revenue desc", () => {
      const courseB = addCourse("course-b");
      addPurchase({ courseId: base.course.id, pricePaid: 1000 });
      addPurchase({ courseId: courseB.id, pricePaid: 5000 });

      const rows = getRevenueByCourse({
        courseIds: [base.course.id, courseB.id],
      });

      expect(rows.map((r) => r.courseId)).toEqual([courseB.id, base.course.id]);
      expect(rows[0].revenue).toBe(5000);
      expect(rows[1].revenue).toBe(1000);
    });

    it("includes in-scope courses with no sales (zero values)", () => {
      const courseB = addCourse("course-b");
      addPurchase({ courseId: base.course.id, pricePaid: 1000 });

      const rows = getRevenueByCourse({
        courseIds: [base.course.id, courseB.id],
      });

      const emptyRow = rows.find((r) => r.courseId === courseB.id);
      expect(emptyRow).toMatchObject({ revenue: 0, transactions: 0, seats: 0 });
    });

    it("reports per-course transactions and seats (team vs individual)", () => {
      addTeamPurchase({ courseId: base.course.id, pricePaid: 30000, seats: 3 });
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });

      const [row] = getRevenueByCourse({ courseIds: [base.course.id] });

      expect(row.transactions).toBe(2);
      expect(row.seats).toBe(4);
      expect(row.revenue).toBe(34999);
    });

    it("only includes courses within the given scope", () => {
      const other = addCourse("other-course");
      addPurchase({ courseId: other.id, pricePaid: 9999 });

      const rows = getRevenueByCourse({ courseIds: [base.course.id] });

      expect(rows).toHaveLength(1);
      expect(rows[0].courseId).toBe(base.course.id);
    });

    it("respects the date range", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2020-01-01T00:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-06-01T00:00:00.000Z",
      });

      const [row] = getRevenueByCourse({
        courseIds: [base.course.id],
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T00:00:00.000Z",
      });

      expect(row.revenue).toBe(2000);
    });

    it("returns an empty array for an empty scope", () => {
      expect(getRevenueByCourse({ courseIds: [] })).toEqual([]);
    });
  });

  describe("getRevenueTimeSeries", () => {
    it("aggregates revenue and sales into daily buckets across the range", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-06-01T08:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-06-01T20:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 5000,
        createdAt: "2026-06-03T10:00:00.000Z",
      });

      const series = getRevenueTimeSeries({
        courseIds: [base.course.id],
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-04T00:00:00.000Z",
      });

      expect(series.map((p) => p.label)).toEqual(["Jun 1", "Jun 2", "Jun 3"]);
      expect(series[0]).toMatchObject({ revenue: 3000, transactions: 2 });
      expect(series[1]).toMatchObject({ revenue: 0, transactions: 0 });
      expect(series[2]).toMatchObject({ revenue: 5000, transactions: 1 });
    });

    it("excludes $0 purchases from the buckets", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 0,
        createdAt: "2026-06-01T08:00:00.000Z",
      });

      const series = getRevenueTimeSeries({
        courseIds: [base.course.id],
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-02T00:00:00.000Z",
      });

      expect(series).toHaveLength(1);
      expect(series[0]).toMatchObject({ revenue: 0, transactions: 0 });
    });

    it("derives the range from the data when none is given (all-time)", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-01-15T00:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 4000,
        createdAt: "2026-03-20T00:00:00.000Z",
      });

      const series = getRevenueTimeSeries({ courseIds: [base.course.id] });

      // ~64-day span → weekly buckets; totals reconcile with the raw revenue.
      expect(series.length).toBeGreaterThan(0);
      const total = series.reduce((sum, p) => sum + p.revenue, 0);
      expect(total).toBe(5000);
    });

    it("honors an explicit granularity", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-01-10T00:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-02-10T00:00:00.000Z",
      });

      const series = getRevenueTimeSeries({
        courseIds: [base.course.id],
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-03-01T00:00:00.000Z",
        granularity: "monthly",
      });

      expect(series.map((p) => p.label)).toEqual(["Jan 2026", "Feb 2026"]);
      expect(series[0].revenue).toBe(1000);
      expect(series[1].revenue).toBe(2000);
    });

    it("returns an empty array for an empty scope or no all-time data", () => {
      expect(getRevenueTimeSeries({ courseIds: [] })).toEqual([]);
      expect(getRevenueTimeSeries({ courseIds: [base.course.id] })).toEqual([]);
    });
  });

  describe("getRevenueByCountry", () => {
    it("groups revenue and sales by country name, sorted by revenue desc", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 1000, country: "US" });
      addPurchase({ courseId: base.course.id, pricePaid: 2000, country: "US" });
      addPurchase({ courseId: base.course.id, pricePaid: 5000, country: "GB" });

      const rows = getRevenueByCountry({ courseIds: [base.course.id] });

      expect(rows).toEqual([
        { country: "United Kingdom", revenue: 5000, transactions: 1 },
        { country: "United States", revenue: 3000, transactions: 2 },
      ]);
    });

    it("buckets null and unrecognized countries under Unknown", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 1000, country: null });
      addPurchase({ courseId: base.course.id, pricePaid: 2000, country: "ZZ" });
      addPurchase({ courseId: base.course.id, pricePaid: 4000, country: "US" });

      const rows = getRevenueByCountry({ courseIds: [base.course.id] });
      const unknown = rows.find((r) => r.country === "Unknown");

      expect(unknown).toEqual({
        country: "Unknown",
        revenue: 3000,
        transactions: 2,
      });
    });

    it("reconciles with the revenue summary total", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 1000, country: "US" });
      addPurchase({ courseId: base.course.id, pricePaid: 2000, country: null });
      addPurchase({ courseId: base.course.id, pricePaid: 4000, country: "IN" });

      const rows = getRevenueByCountry({ courseIds: [base.course.id] });
      const summary = getRevenueSummary({ courseIds: [base.course.id] });

      const total = rows.reduce((sum, r) => sum + r.revenue, 0);
      expect(total).toBe(summary.totalRevenue);
    });

    it("only includes in-scope courses and respects the date range", () => {
      const other = addCourse("other-course");
      addPurchase({ courseId: other.id, pricePaid: 9999, country: "US" });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 1000,
        country: "US",
        createdAt: "2020-01-01T00:00:00.000Z",
      });
      addPurchase({
        courseId: base.course.id,
        pricePaid: 2000,
        country: "US",
        createdAt: "2026-06-01T00:00:00.000Z",
      });

      const rows = getRevenueByCountry({
        courseIds: [base.course.id],
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T00:00:00.000Z",
      });

      expect(rows).toEqual([
        { country: "United States", revenue: 2000, transactions: 1 },
      ]);
    });

    it("returns an empty array for an empty scope", () => {
      expect(getRevenueByCountry({ courseIds: [] })).toEqual([]);
    });
  });

  describe("getOutstandingSeats", () => {
    it("counts unredeemed coupons for in-scope courses", () => {
      addTeamPurchase({
        courseId: base.course.id,
        pricePaid: 30000,
        seats: 3,
        redeemed: 1,
      });

      expect(getOutstandingSeats({ courseIds: [base.course.id] })).toBe(2);
    });

    it("ignores coupons for courses outside the scope", () => {
      const other = addCourse("other-course");
      addTeamPurchase({ courseId: base.course.id, pricePaid: 30000, seats: 2 });
      addTeamPurchase({ courseId: other.id, pricePaid: 30000, seats: 4 });

      expect(getOutstandingSeats({ courseIds: [base.course.id] })).toBe(2);
    });

    it("is not affected by the date range (snapshot of current state)", () => {
      addTeamPurchase({
        courseId: base.course.id,
        pricePaid: 30000,
        seats: 5,
        redeemed: 2,
        createdAt: "2020-01-01T00:00:00.000Z",
      });

      expect(getOutstandingSeats({ courseIds: [base.course.id] })).toBe(3);
    });

    it("returns 0 for an empty scope", () => {
      expect(getOutstandingSeats({ courseIds: [] })).toBe(0);
    });
  });

  describe("getEnrollmentCount", () => {
    it("counts enrollments for the in-scope courses", () => {
      addEnrollment({ courseId: base.course.id });
      addEnrollment({ courseId: base.course.id });

      expect(getEnrollmentCount({ courseIds: [base.course.id] })).toBe(2);
    });

    it("ignores enrollments for courses outside the scope", () => {
      const other = addCourse("other-course");
      addEnrollment({ courseId: base.course.id });
      addEnrollment({ courseId: other.id });

      expect(getEnrollmentCount({ courseIds: [base.course.id] })).toBe(1);
    });

    it("filters by the enrolledAt date range", () => {
      addEnrollment({
        courseId: base.course.id,
        enrolledAt: "2024-06-15T00:00:00.000Z",
      });
      addEnrollment({
        courseId: base.course.id,
        enrolledAt: "2020-01-01T00:00:00.000Z",
      });

      expect(
        getEnrollmentCount({
          courseIds: [base.course.id],
          from: "2024-01-01T00:00:00.000Z",
          to: "2025-01-01T00:00:00.000Z",
        })
      ).toBe(1);
    });

    it("returns 0 for an empty scope", () => {
      expect(getEnrollmentCount({ courseIds: [] })).toBe(0);
    });
  });

  describe("getTopEarningCourse", () => {
    it("returns the highest-earning course across the scope", () => {
      const other = addCourse("other-course");
      addPurchase({ courseId: base.course.id, pricePaid: 4999 });
      addPurchase({ courseId: other.id, pricePaid: 9999 });

      const top = getTopEarningCourse({
        courseIds: [base.course.id, other.id],
      });

      expect(top).toEqual({
        courseId: other.id,
        title: `Course other-course`,
        revenue: 9999,
      });
    });

    it("returns null when no in-scope course has revenue", () => {
      addPurchase({ courseId: base.course.id, pricePaid: 0 });

      expect(getTopEarningCourse({ courseIds: [base.course.id] })).toBeNull();
    });

    it("respects the date range", () => {
      addPurchase({
        courseId: base.course.id,
        pricePaid: 4999,
        createdAt: "2020-01-01T00:00:00.000Z",
      });

      expect(
        getTopEarningCourse({
          courseIds: [base.course.id],
          from: "2024-01-01T00:00:00.000Z",
          to: "2025-01-01T00:00:00.000Z",
        })
      ).toBeNull();
    });

    it("returns null for an empty scope", () => {
      expect(getTopEarningCourse({ courseIds: [] })).toBeNull();
    });
  });
});
