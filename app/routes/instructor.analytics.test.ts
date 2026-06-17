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

const request = new Request("http://localhost/instructor/analytics");

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

function addPurchase(courseId: number, pricePaid: number) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, pricePaid, country: "US" })
    .run();
}

async function loaderStatus(): Promise<number | undefined> {
  try {
    await loader({ request, params: {}, context: {} } as never);
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
    const result = await loader({ request, params: {}, context: {} } as never);

    expect(result.scope).toBe("instructor");
    expect(result.totalRevenue).toBe(4999);
  });

  it("gives admins platform-wide totals across all courses", async () => {
    const { course2 } = addOtherInstructorCourse();
    addPurchase(base.course.id, 4999);
    addPurchase(course2.id, 9999);
    const admin = addAdmin();

    getCurrentUserIdMock.mockResolvedValue(admin.id);
    const result = await loader({ request, params: {}, context: {} } as never);

    expect(result.scope).toBe("platform");
    expect(result.totalRevenue).toBe(14998);
  });
});
