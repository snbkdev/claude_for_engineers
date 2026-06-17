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
} from "./analyticsService";

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
      country: opts.country ?? "US",
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
});
