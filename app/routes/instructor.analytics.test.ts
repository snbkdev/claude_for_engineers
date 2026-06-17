import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

const { getCurrentUserIdMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
}));

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: getCurrentUserIdMock,
}));

import { loader } from "./instructor.analytics";

function requestWith(query = ""): Request {
  return new Request(`http://localhost/instructor/analytics${query}`);
}

const request = requestWith();

function callLoader(req: Request) {
  return loader({ request: req, params: {}, context: {} } as never);
}

function addAdmin() {
  return testDb
    .insert(schema.users)
    .values({ name: "Admin", email: "admin@example.com", role: schema.UserRole.Admin })
    .returning()
    .get();
}

function addOtherInstructorCourse() {
  const instructor2 = testDb
    .insert(schema.users)
    .values({ name: "Other", email: "other@example.com", role: schema.UserRole.Instructor })
    .returning()
    .get();
  const course2 = testDb
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Owned by another instructor",
      instructorId: instructor2.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  return { instructor2, course2 };
}

function addPurchase(courseId: number, pricePaid: number, createdAt?: string) {
  testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId,
      pricePaid,
      country: "US",
      ...(createdAt ? { createdAt } : {}),
    })
    .run();
}

async function loaderStatus(): Promise<number | undefined> {
  try {
    await callLoader(request);
  } catch (err) {
    return (err as { init?: { status?: number } })?.init?.status;
  }
  return undefined;
}

describe("instructor.analytics loader", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserIdMock.mockReset();
  });

  it("throws 401 when no user is selected", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);
    expect(await loaderStatus()).toBe(401);
  });

  it("throws 403 for students", async () => {
    getCurrentUserIdMock.mockResolvedValue(base.user.id);
    expect(await loaderStatus()).toBe(403);
  });

  it("scopes an instructor to their own courses only", async () => {
    const { course2 } = addOtherInstructorCourse();
    addPurchase(base.course.id, 4999); // owned by base.instructor
    addPurchase(course2.id, 9999); // owned by another instructor

    getCurrentUserIdMock.mockResolvedValue(base.instructor.id);
    const result = await callLoader(request);

    expect(result.scope).toBe("instructor");
    expect(result.allTimeRevenue).toBe(4999);
  });

  it("gives admins platform-wide totals across all courses", async () => {
    const { course2 } = addOtherInstructorCourse();
    addPurchase(base.course.id, 4999);
    addPurchase(course2.id, 9999);
    const admin = addAdmin();

    getCurrentUserIdMock.mockResolvedValue(admin.id);
    const result = await callLoader(request);

    expect(result.scope).toBe("platform");
    expect(result.allTimeRevenue).toBe(14998);
  });

  it("defaults to a 30-day period while all-time stays unbounded", async () => {
    const recent = new Date(Date.now() - 5 * 86400_000).toISOString();
    addPurchase(base.course.id, 4999, recent); // within last 30 days
    addPurchase(base.course.id, 1000, "2020-01-01T00:00:00.000Z"); // old

    getCurrentUserIdMock.mockResolvedValue(base.instructor.id);
    const result = await callLoader(request);

    expect(result.range.preset).toBe("30d");
    expect(result.periodRevenue).toBe(4999);
    expect(result.allTimeRevenue).toBe(5999);
  });

  it("honors a custom from–to range from query params", async () => {
    addPurchase(base.course.id, 4999, "2020-06-15T00:00:00.000Z");
    addPurchase(base.course.id, 1000, "2026-06-01T00:00:00.000Z");

    getCurrentUserIdMock.mockResolvedValue(base.instructor.id);
    const result = await callLoader(
      requestWith("?from=2020-06-01&to=2020-06-30")
    );

    expect(result.range.preset).toBe("custom");
    expect(result.range.fromDate).toBe("2020-06-01");
    expect(result.periodRevenue).toBe(4999);
    expect(result.allTimeRevenue).toBe(5999);
  });

  it("exposes the full KPI set (sales, AOV, seats, outstanding)", async () => {
    // One team purchase (3 seats, 1 redeemed) + one individual, both recent.
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 30000,
        country: "US",
        createdAt: recent,
      })
      .returning()
      .get();
    const team = testDb.insert(schema.teams).values({}).returning().get();
    for (let i = 0; i < 3; i++) {
      testDb
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: `c-${i}`,
          purchaseId: teamPurchase.id,
          redeemedByUserId: i === 0 ? base.user.id : null,
        })
        .run();
    }
    addPurchase(base.course.id, 10000, recent); // individual

    getCurrentUserIdMock.mockResolvedValue(base.instructor.id);
    const result = await callLoader(request);

    expect(result.salesCount).toBe(2);
    expect(result.averageOrderValue).toBe((30000 + 10000) / 2);
    expect(result.seatsSold).toBe(4); // 3 team + 1 individual
    expect(result.outstandingSeats).toBe(2); // 3 team seats, 1 redeemed
  });
});
