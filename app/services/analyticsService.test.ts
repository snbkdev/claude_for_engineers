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

import { getRevenueSummary } from "./analyticsService";

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
  });
});
