import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
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
  submitForReview,
  approveCourse,
  rejectCourse,
} from "./moderationService";

function makeAdmin() {
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

function getCourse() {
  return testDb
    .select()
    .from(schema.courses)
    .where(eq(schema.courses.id, base.course.id))
    .get()!;
}

function notificationsFor(userId: number) {
  return testDb
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.recipientUserId, userId))
    .all();
}

describe("moderationService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("submitForReview flags the course pending and notifies every admin", () => {
    const admin1 = makeAdmin();
    const admin2 = testDb
      .insert(schema.users)
      .values({
        name: "Admin Two",
        email: "admin2@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    const result = submitForReview(base.course.id);

    expect(result.ok).toBe(true);
    expect(getCourse().moderationStatus).toBe(schema.ModerationStatus.Pending);
    expect(notificationsFor(admin1.id)).toHaveLength(1);
    expect(notificationsFor(admin2.id)).toHaveLength(1);
    expect(notificationsFor(admin1.id)[0].type).toBe(
      schema.NotificationType.CourseModeration
    );
  });

  it("approveCourse marks approved, clears any reason, and notifies the instructor", () => {
    makeAdmin();
    // Put it into a rejected state first to prove the reason is cleared.
    rejectCourse({ courseId: base.course.id, reason: "needs polish" });
    const before = notificationsFor(base.instructor.id).length;

    const result = approveCourse(base.course.id);

    expect(result.ok).toBe(true);
    const course = getCourse();
    expect(course.moderationStatus).toBe(schema.ModerationStatus.Approved);
    expect(course.rejectionReason).toBeNull();
    expect(notificationsFor(base.instructor.id).length).toBe(before + 1);
  });

  it("rejectCourse sends the course back to draft with a reason and notifies the instructor", () => {
    const result = rejectCourse({
      courseId: base.course.id,
      reason: "  Improve the intro module  ",
    });

    expect(result.ok).toBe(true);
    const course = getCourse();
    expect(course.status).toBe(schema.CourseStatus.Draft);
    expect(course.moderationStatus).toBe(schema.ModerationStatus.Rejected);
    expect(course.rejectionReason).toBe("Improve the intro module");
    const notes = notificationsFor(base.instructor.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain("Improve the intro module");
  });

  it("rejectCourse rejects an empty reason without touching the course", () => {
    const result = rejectCourse({ courseId: base.course.id, reason: "   " });

    expect(result.ok).toBe(false);
    expect(getCourse().status).toBe(schema.CourseStatus.Published);
    expect(getCourse().moderationStatus).toBe(schema.ModerationStatus.Approved);
  });

  it("returns an error for an unknown course", () => {
    expect(submitForReview(9999).ok).toBe(false);
    expect(approveCourse(9999).ok).toBe(false);
    expect(rejectCourse({ courseId: 9999, reason: "x" }).ok).toBe(false);
  });
});
