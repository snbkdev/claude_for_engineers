import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus, CourseStatus } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  evaluateAchievements,
  getAchievementShowcase,
  computeAchievementStats,
  ACHIEVEMENTS,
} from "./achievementService";

// ─── Fixture helpers ───

function addLesson(): number {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "M", position: 0 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "L", position: 0 })
    .returning()
    .get().id;
}

function completeLesson(lessonId: number, completedAt?: string) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId: base.user.id,
      lessonId,
      status: LessonProgressStatus.Completed,
      completedAt: completedAt ?? new Date().toISOString(),
    })
    .run();
}

function addCompletedEnrollment() {
  const course = testDb
    .insert(schema.courses)
    .values({
      title: `C${Math.random()}`,
      slug: `c-${Math.random().toString(36).slice(2)}`,
      description: "d",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: CourseStatus.Published,
    })
    .returning()
    .get();
  testDb
    .insert(schema.enrollments)
    .values({
      userId: base.user.id,
      courseId: course.id,
      completedAt: new Date().toISOString(),
    })
    .run();
}

function addAceAttempt() {
  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId: addLesson(), title: "Q", passingScore: 0.7 })
    .returning()
    .get();
  testDb
    .insert(schema.quizAttempts)
    .values({
      userId: base.user.id,
      quizId: quiz.id,
      score: 0.95,
      passed: true,
    })
    .run();
}

describe("achievementService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("evaluateAchievements", () => {
    it("awards 'first-lesson' once a lesson is completed and is idempotent", () => {
      const first = evaluateAchievements({ userId: base.user.id });
      expect(first).toEqual([]); // no progress yet

      completeLesson(addLesson());

      const awarded = evaluateAchievements({ userId: base.user.id });
      expect(awarded.map((a) => a.key)).toContain("first-lesson");

      // Second evaluation does not re-award.
      const again = evaluateAchievements({ userId: base.user.id });
      expect(again.map((a) => a.key)).not.toContain("first-lesson");

      const rows = testDb.select().from(schema.achievements).all();
      expect(rows.filter((r) => r.key === "first-lesson")).toHaveLength(1);
    });

    it("awards 'first-course' when a course is completed", () => {
      addCompletedEnrollment();
      const awarded = evaluateAchievements({ userId: base.user.id });
      expect(awarded.map((a) => a.key)).toContain("first-course");
      expect(awarded.map((a) => a.key)).not.toContain("five-courses");
    });

    it("awards 'five-courses' only after five completions", () => {
      for (let i = 0; i < 4; i++) addCompletedEnrollment();
      let keys = evaluateAchievements({ userId: base.user.id }).map(
        (a) => a.key
      );
      expect(keys).not.toContain("five-courses");

      addCompletedEnrollment();
      keys = evaluateAchievements({ userId: base.user.id }).map((a) => a.key);
      expect(keys).toContain("five-courses");
    });

    it("awards quiz badges by distinct A-grade quizzes", () => {
      addAceAttempt();
      let keys = evaluateAchievements({ userId: base.user.id }).map(
        (a) => a.key
      );
      expect(keys).toContain("quiz-ace");
      expect(keys).not.toContain("quiz-master");

      for (let i = 0; i < 4; i++) addAceAttempt();
      keys = evaluateAchievements({ userId: base.user.id }).map((a) => a.key);
      expect(keys).toContain("quiz-master");
    });

    it("awards 'streak-7' for seven consecutive active days", () => {
      // Six consecutive days is not enough.
      for (let d = 1; d <= 6; d++) {
        completeLesson(addLesson(), `2026-06-0${d}T12:00:00.000Z`);
      }
      let keys = evaluateAchievements({ userId: base.user.id }).map(
        (a) => a.key
      );
      expect(keys).not.toContain("streak-7");

      completeLesson(addLesson(), `2026-06-07T12:00:00.000Z`);
      keys = evaluateAchievements({ userId: base.user.id }).map((a) => a.key);
      expect(keys).toContain("streak-7");
    });

    it("scopes stats and awards per user", () => {
      completeLesson(addLesson());
      evaluateAchievements({ userId: base.user.id });

      // The instructor has no progress → no badges.
      const instructorStats = computeAchievementStats(base.instructor.id);
      expect(instructorStats.completedLessons).toBe(0);
      const showcase = getAchievementShowcase(base.instructor.id);
      expect(showcase.every((s) => !s.earned)).toBe(true);
    });
  });

  describe("getAchievementShowcase", () => {
    it("returns every catalog entry with earned flags", () => {
      completeLesson(addLesson());
      evaluateAchievements({ userId: base.user.id });

      const showcase = getAchievementShowcase(base.user.id);
      expect(showcase).toHaveLength(ACHIEVEMENTS.length);

      const firstLesson = showcase.find((s) => s.key === "first-lesson")!;
      expect(firstLesson.earned).toBe(true);
      expect(firstLesson.earnedAt).not.toBeNull();

      const fiveCourses = showcase.find((s) => s.key === "five-courses")!;
      expect(fiveCourses.earned).toBe(false);
      expect(fiveCourses.earnedAt).toBeNull();
    });
  });
});
