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
  isCourseBookmarked,
  isLessonBookmarked,
  toggleCourseBookmark,
  toggleLessonBookmark,
  removeCourseBookmark,
  getBookmarkedCourses,
  getBookmarkedLessons,
} from "./bookmarkService";

function seedLesson() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 0 })
    .returning()
    .get();

  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 0 })
    .returning()
    .get();
}

describe("bookmarkService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("course bookmarks", () => {
    it("toggles a course bookmark on and off", () => {
      expect(isCourseBookmarked(base.user.id, base.course.id)).toBe(false);

      const added = toggleCourseBookmark(base.user.id, base.course.id);
      expect(added.bookmarked).toBe(true);
      expect(isCourseBookmarked(base.user.id, base.course.id)).toBe(true);

      const removed = toggleCourseBookmark(base.user.id, base.course.id);
      expect(removed.bookmarked).toBe(false);
      expect(isCourseBookmarked(base.user.id, base.course.id)).toBe(false);
    });

    it("scopes bookmarks per user", () => {
      toggleCourseBookmark(base.user.id, base.course.id);
      expect(isCourseBookmarked(base.instructor.id, base.course.id)).toBe(false);
    });

    it("removeCourseBookmark is a no-op when nothing is bookmarked", () => {
      expect(() =>
        removeCourseBookmark(base.user.id, base.course.id)
      ).not.toThrow();
      expect(isCourseBookmarked(base.user.id, base.course.id)).toBe(false);
    });
  });

  describe("lesson bookmarks", () => {
    it("toggles a lesson bookmark on and off", () => {
      const lesson = seedLesson();
      expect(isLessonBookmarked(base.user.id, lesson.id)).toBe(false);

      expect(toggleLessonBookmark(base.user.id, lesson.id).bookmarked).toBe(
        true
      );
      expect(isLessonBookmarked(base.user.id, lesson.id)).toBe(true);

      expect(toggleLessonBookmark(base.user.id, lesson.id).bookmarked).toBe(
        false
      );
      expect(isLessonBookmarked(base.user.id, lesson.id)).toBe(false);
    });
  });

  describe("listing", () => {
    it("getBookmarkedCourses returns only course bookmarks with details", () => {
      const lesson = seedLesson();
      toggleCourseBookmark(base.user.id, base.course.id);
      toggleLessonBookmark(base.user.id, lesson.id);

      const rows = getBookmarkedCourses(base.user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].courseId).toBe(base.course.id);
      expect(rows[0].courseTitle).toBe(base.course.title);
      expect(rows[0].instructorName).toBe(base.instructor.name);
    });

    it("getBookmarkedLessons returns only lesson bookmarks with course context", () => {
      const lesson = seedLesson();
      toggleCourseBookmark(base.user.id, base.course.id);
      toggleLessonBookmark(base.user.id, lesson.id);

      const rows = getBookmarkedLessons(base.user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].lessonId).toBe(lesson.id);
      expect(rows[0].lessonTitle).toBe(lesson.title);
      expect(rows[0].courseSlug).toBe(base.course.slug);
      expect(rows[0].moduleTitle).toBe("Module 1");
    });
  });
});
