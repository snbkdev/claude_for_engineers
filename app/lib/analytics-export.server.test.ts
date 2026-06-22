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
  buildAnalyticsTable,
  buildAllAnalyticsTables,
  isAnalyticsDataset,
  ANALYTICS_DATASETS,
} from "./analytics-export.server";

function purchase(opts: {
  courseId: number;
  pricePaid: number;
  country: string | null;
}) {
  testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: opts.courseId,
      pricePaid: opts.pricePaid,
      country: opts.country,
    })
    .run();
}

describe("analytics-export.server", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("isAnalyticsDataset validates known keys", () => {
    expect(isAnalyticsDataset("courses")).toBe(true);
    expect(isAnalyticsDataset("nope")).toBe(false);
    expect(isAnalyticsDataset(null)).toBe(false);
  });

  it("courses table emits USD revenue and a header row", () => {
    purchase({ courseId: base.course.id, pricePaid: 10000, country: "US" });
    const table = buildAnalyticsTable("courses", {
      courseIds: [base.course.id],
    });
    expect(table.sheetName).toBe("Courses");
    expect(table.headers[1]).toBe("Revenue (USD)");
    const row = table.rows.find((r) => r[0] === base.course.title);
    expect(row).toBeDefined();
    // 10000 cents → 100 USD.
    expect(row?.[1]).toBe(100);
  });

  it("countries table groups by country with USD revenue", () => {
    purchase({ courseId: base.course.id, pricePaid: 5000, country: "US" });
    purchase({ courseId: base.course.id, pricePaid: 2500, country: null });
    const table = buildAnalyticsTable("countries", {
      courseIds: [base.course.id],
    });
    expect(table.headers).toEqual(["Country", "Revenue (USD)", "Sales"]);
    const total = table.rows.reduce((sum, r) => sum + Number(r[1]), 0);
    expect(total).toBe(75); // (5000 + 2500) / 100
  });

  it("buildAllAnalyticsTables returns one table per dataset", () => {
    const tables = buildAllAnalyticsTables({ courseIds: [base.course.id] });
    expect(tables.map((t) => t.dataset)).toEqual(ANALYTICS_DATASETS);
  });
});
