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

import { loader } from "./admin.analytics";

function requestWith(query = ""): Request {
  return new Request(`http://localhost/admin/analytics${query}`);
}

function callLoader(req: Request) {
  return loader({ request: req, params: {}, context: {} } as never);
}

function addAdmin() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
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

function addEnrollment(courseId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId: base.user.id, courseId })
    .run();
}

async function loaderStatus(req: Request): Promise<number | undefined> {
  try {
    await callLoader(req);
  } catch (err) {
    return (err as { init?: { status?: number } })?.init?.status;
  }
  return undefined;
}

describe("admin.analytics loader", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserIdMock.mockReset();
  });

  it("throws 401 when no user is selected", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);
    expect(await loaderStatus(requestWith())).toBe(401);
  });

  it("throws 403 for students", async () => {
    getCurrentUserIdMock.mockResolvedValue(base.user.id);
    expect(await loaderStatus(requestWith())).toBe(403);
  });

  it("throws 403 for instructors", async () => {
    getCurrentUserIdMock.mockResolvedValue(base.instructor.id);
    expect(await loaderStatus(requestWith())).toBe(403);
  });

  it("aggregates revenue and enrollments across every course", async () => {
    const other = addCourse("other-course");
    addPurchase(base.course.id, 4999);
    addPurchase(other.id, 9999);
    addEnrollment(base.course.id);
    addEnrollment(other.id);
    const admin = addAdmin();

    getCurrentUserIdMock.mockResolvedValue(admin.id);
    const result = await callLoader(requestWith("?preset=all"));

    expect(result.totalRevenue).toBe(14998);
    expect(result.totalEnrollments).toBe(2);
    expect(result.topCourse).toEqual({
      courseId: other.id,
      title: "Course other-course",
      revenue: 9999,
    });
  });

  it("returns a null top course when there are no sales", async () => {
    addEnrollment(base.course.id);
    const admin = addAdmin();

    getCurrentUserIdMock.mockResolvedValue(admin.id);
    const result = await callLoader(requestWith("?preset=all"));

    expect(result.totalRevenue).toBe(0);
    expect(result.topCourse).toBeNull();
  });

  it("defaults to a 30-day period", async () => {
    const recent = new Date(Date.now() - 5 * 86400_000).toISOString();
    addPurchase(base.course.id, 4999, recent);
    addPurchase(base.course.id, 1000, "2020-01-01T00:00:00.000Z");
    const admin = addAdmin();

    getCurrentUserIdMock.mockResolvedValue(admin.id);
    const result = await callLoader(requestWith());

    expect(result.range.preset).toBe("30d");
    expect(result.totalRevenue).toBe(4999);
  });
});
