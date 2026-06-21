import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, LessonProgressStatus, UserRole } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getProfile } from "./profileService";
import { evaluateAchievements } from "./achievementService";

let seq = 0;
function addStudent(name = "Stu"): number {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `p${seq++}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get().id;
}

function addCourse(status = CourseStatus.Published): number {
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${seq}`,
      slug: `course-${seq++}`,
      description: "d",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get().id;
}

function rate(courseId: number, userId: number, rating: number) {
  testDb
    .insert(schema.courseRatings)
    .values({ courseId, userId, rating })
    .run();
}

function completeLessonFor(userId: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "M", position: 0 })
    .returning()
    .get();
  const lessonId = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "L", position: 0 })
    .returning()
    .get().id;
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .run();
}

describe("profileService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    seq = 0;
  });

  it("returns null for an unknown user", () => {
    expect(getProfile(99999)).toBeNull();
  });

  describe("instructor profile", () => {
    it("lists published courses with ratings and a weighted average", () => {
      // base.course (seeded, published) + one more; one draft is excluded.
      const c2 = addCourse(CourseStatus.Published);
      addCourse(CourseStatus.Draft);

      const s1 = addStudent();
      const s2 = addStudent();
      rate(base.course.id, s1, 4);
      rate(base.course.id, s2, 2); // avg 3 (count 2)
      rate(c2, s1, 5); // avg 5 (count 1)

      const profile = getProfile(base.instructor.id)!;
      expect(profile.student).toBeNull();
      expect(profile.instructor).not.toBeNull();
      const ins = profile.instructor!;
      // Two published courses (draft excluded).
      expect(ins.courseCount).toBe(2);
      // Weighted: (3*2 + 5*1) / 3 = 3.67 → rounded 3.7
      expect(ins.averageRating).toBe(3.7);
    });
  });

  describe("student profile", () => {
    it("computes level/XP and earned badges", () => {
      const studentId = addStudent("Learner");
      completeLessonFor(studentId); // 1 lesson → 10 XP
      // Profiles are read-only: badges must already be awarded by the evaluator.
      evaluateAchievements({ userId: studentId });

      const profile = getProfile(studentId)!;
      expect(profile.instructor).toBeNull();
      expect(profile.studentPrivate).toBe(false);
      const st = profile.student!;
      expect(st.completedLessons).toBe(1);
      expect(st.xp).toBe(10);
      expect(st.badges.some((b) => b.key === "first-lesson")).toBe(true);
    });

    it("hides stats for an opted-out student", () => {
      const studentId = addStudent("Hidden");
      completeLessonFor(studentId);
      testDb
        .update(schema.users)
        .set({ leaderboardOptOut: true })
        .where(eq(schema.users.id, studentId))
        .run();

      const profile = getProfile(studentId)!;
      expect(profile.studentPrivate).toBe(true);
      expect(profile.student).toBeNull();
      // Public fields still present.
      expect(profile.user.name).toBe("Hidden");
    });
  });
});
