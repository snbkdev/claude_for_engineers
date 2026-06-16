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
  toggleBookmark,
  isLessonBookmarked,
  getBookmarkedLessonIds,
} from "./bookmarkService";

function seedModule(courseId: number, title = "Module 1") {
  return testDb
    .insert(schema.modules)
    .values({ courseId, title, position: 0 })
    .returning()
    .get();
}

function seedLesson(moduleId: number, title = "Lesson 1", position = 0) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

describe("bookmarkService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("toggleBookmark", () => {
    it("adds a bookmark when none exists", () => {
      const lesson = seedLesson(seedModule(base.course.id).id);

      const result = toggleBookmark({
        userId: base.user.id,
        lessonId: lesson.id,
      });

      expect(result).toEqual({ bookmarked: true });
      expect(
        isLessonBookmarked({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(true);
    });

    it("removes the bookmark when one already exists", () => {
      const lesson = seedLesson(seedModule(base.course.id).id);

      toggleBookmark({ userId: base.user.id, lessonId: lesson.id });
      const result = toggleBookmark({
        userId: base.user.id,
        lessonId: lesson.id,
      });

      expect(result).toEqual({ bookmarked: false });
      expect(
        isLessonBookmarked({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(false);
    });
  });

  describe("isLessonBookmarked", () => {
    it("returns false for a lesson the user has not bookmarked", () => {
      const lesson = seedLesson(seedModule(base.course.id).id);
      expect(
        isLessonBookmarked({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(false);
    });

    it("is scoped per user", () => {
      const lesson = seedLesson(seedModule(base.course.id).id);
      toggleBookmark({ userId: base.user.id, lessonId: lesson.id });

      expect(
        isLessonBookmarked({ userId: base.instructor.id, lessonId: lesson.id })
      ).toBe(false);
    });
  });

  describe("getBookmarkedLessonIds", () => {
    it("returns the IDs of bookmarked lessons in the course", () => {
      const mod = seedModule(base.course.id);
      const lesson1 = seedLesson(mod.id, "Lesson 1", 0);
      const lesson2 = seedLesson(mod.id, "Lesson 2", 1);
      seedLesson(mod.id, "Lesson 3", 2); // left unbookmarked

      toggleBookmark({ userId: base.user.id, lessonId: lesson1.id });
      toggleBookmark({ userId: base.user.id, lessonId: lesson2.id });

      const ids = getBookmarkedLessonIds({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(ids.sort()).toEqual([lesson1.id, lesson2.id].sort());
    });

    it("does not include bookmarks from other courses", () => {
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const lessonInCourse = seedLesson(seedModule(base.course.id).id);
      const lessonInOther = seedLesson(seedModule(otherCourse.id).id);

      toggleBookmark({ userId: base.user.id, lessonId: lessonInCourse.id });
      toggleBookmark({ userId: base.user.id, lessonId: lessonInOther.id });

      const ids = getBookmarkedLessonIds({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(ids).toEqual([lessonInCourse.id]);
    });

    it("does not include other users' bookmarks", () => {
      const lesson = seedLesson(seedModule(base.course.id).id);
      toggleBookmark({ userId: base.instructor.id, lessonId: lesson.id });

      const ids = getBookmarkedLessonIds({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(ids).toEqual([]);
    });
  });
});
