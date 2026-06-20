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

// Import after the mock so the service (and the progress/enrollment services it
// depends on) pick up the in-memory test db.
import {
  issueCertificate,
  getCertificateForCourse,
  getCertificateByCode,
  getUserCertificates,
  maybeCompleteCourse,
} from "./certificateService";

// Adds `count` lessons under a single module on the seeded course.
function addLessons(courseId: number, count: number): number[] {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module 1", position: 0 })
    .returning()
    .get();

  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i })
      .returning()
      .get();
    ids.push(lesson.id);
  }
  return ids;
}

function completeLesson(userId: number, lessonId: number) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .run();
}

function enroll(userId: number, courseId: number) {
  testDb.insert(schema.enrollments).values({ userId, courseId }).run();
}

describe("certificateService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("issueCertificate", () => {
    it("creates a certificate with a verification code", () => {
      const cert = issueCertificate({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(cert.userId).toBe(base.user.id);
      expect(cert.courseId).toBe(base.course.id);
      expect(cert.code).toBeTruthy();
      expect(cert.issuedAt).toBeTruthy();
    });

    it("is idempotent — re-issuing returns the same certificate", () => {
      const first = issueCertificate({
        userId: base.user.id,
        courseId: base.course.id,
      });
      const second = issueCertificate({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(second.id).toBe(first.id);
      expect(second.code).toBe(first.code);

      const all = testDb
        .select()
        .from(schema.certificates)
        .where(eq(schema.certificates.userId, base.user.id))
        .all();
      expect(all).toHaveLength(1);
    });
  });

  describe("getCertificateForCourse", () => {
    it("returns undefined when no certificate exists", () => {
      expect(
        getCertificateForCourse({
          userId: base.user.id,
          courseId: base.course.id,
        })
      ).toBeUndefined();
    });
  });

  describe("maybeCompleteCourse", () => {
    it("returns null when progress is below 100%", () => {
      const [l1] = addLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      completeLesson(base.user.id, l1); // 1 of 2 = 50%

      const result = maybeCompleteCourse({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(result).toBeNull();
      expect(
        getCertificateForCourse({
          userId: base.user.id,
          courseId: base.course.id,
        })
      ).toBeUndefined();
    });

    it("returns null when the user is not enrolled", () => {
      const lessons = addLessons(base.course.id, 1);
      completeLesson(base.user.id, lessons[0]); // 100% but not enrolled

      expect(
        maybeCompleteCourse({
          userId: base.user.id,
          courseId: base.course.id,
        })
      ).toBeNull();
    });

    it("marks the enrollment complete and issues a certificate at 100%", () => {
      const lessons = addLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      lessons.forEach((id) => completeLesson(base.user.id, id));

      const cert = maybeCompleteCourse({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(cert).not.toBeNull();

      const enrollment = testDb
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.userId, base.user.id))
        .get();
      expect(enrollment?.completedAt).toBeTruthy();
    });

    it("is idempotent — does not duplicate the certificate or move completedAt", () => {
      const lessons = addLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id);
      completeLesson(base.user.id, lessons[0]);

      const first = maybeCompleteCourse({
        userId: base.user.id,
        courseId: base.course.id,
      })!;
      const completedAtAfterFirst = testDb
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.userId, base.user.id))
        .get()?.completedAt;

      const second = maybeCompleteCourse({
        userId: base.user.id,
        courseId: base.course.id,
      })!;
      const completedAtAfterSecond = testDb
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.userId, base.user.id))
        .get()?.completedAt;

      expect(second.id).toBe(first.id);
      expect(completedAtAfterSecond).toBe(completedAtAfterFirst);

      const all = testDb.select().from(schema.certificates).all();
      expect(all).toHaveLength(1);
    });
  });

  describe("getCertificateByCode", () => {
    it("returns recipient, course and instructor for a valid code", () => {
      const cert = issueCertificate({
        userId: base.user.id,
        courseId: base.course.id,
      });

      const found = getCertificateByCode(cert.code);

      expect(found).not.toBeNull();
      expect(found!.recipientName).toBe(base.user.name);
      expect(found!.courseTitle).toBe(base.course.title);
      expect(found!.instructorName).toBe(base.instructor.name);
    });

    it("returns null for an unknown code", () => {
      expect(getCertificateByCode("does-not-exist")).toBeNull();
    });
  });

  describe("getUserCertificates", () => {
    it("lists the user's certificates", () => {
      issueCertificate({ userId: base.user.id, courseId: base.course.id });

      const list = getUserCertificates(base.user.id);
      expect(list).toHaveLength(1);
      expect(list[0].courseTitle).toBe(base.course.title);
    });
  });
});
