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
  rateCourse,
  getUserRating,
  getAverageRating,
  getAverageRatingsForCourses,
} from "./ratingService";

function seedSecondCourse() {
  return testDb
    .insert(schema.courses)
    .values({
      title: "Second Course",
      slug: "second-course",
      description: "Another course",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function seedStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("rateCourse", () => {
    it("inserts a new rating", () => {
      const rating = rateCourse(base.user.id, base.course.id, 4);
      expect(rating.rating).toBe(4);
      expect(getUserRating(base.user.id, base.course.id)?.rating).toBe(4);
    });

    it("updates the existing rating instead of inserting a duplicate", () => {
      rateCourse(base.user.id, base.course.id, 3);
      rateCourse(base.user.id, base.course.id, 5);

      expect(getUserRating(base.user.id, base.course.id)?.rating).toBe(5);
      const { count } = getAverageRating(base.course.id);
      expect(count).toBe(1);
    });

    it("rejects ratings outside 1–5 or non-integers", () => {
      expect(() => rateCourse(base.user.id, base.course.id, 0)).toThrow();
      expect(() => rateCourse(base.user.id, base.course.id, 6)).toThrow();
      expect(() => rateCourse(base.user.id, base.course.id, 3.5)).toThrow();
    });
  });

  describe("getAverageRating", () => {
    it("returns null average and zero count when unrated", () => {
      expect(getAverageRating(base.course.id)).toEqual({
        average: null,
        count: 0,
      });
    });

    it("averages multiple ratings and rounds to one decimal", () => {
      const u2 = seedStudent("u2@example.com");
      const u3 = seedStudent("u3@example.com");
      rateCourse(base.user.id, base.course.id, 5);
      rateCourse(u2.id, base.course.id, 4);
      rateCourse(u3.id, base.course.id, 4); // avg = 13/3 = 4.333 → 4.3

      expect(getAverageRating(base.course.id)).toEqual({
        average: 4.3,
        count: 3,
      });
    });
  });

  describe("getAverageRatingsForCourses", () => {
    it("returns an empty map for no course ids", () => {
      expect(getAverageRatingsForCourses([]).size).toBe(0);
    });

    it("maps each course to its average and count", () => {
      const second = seedSecondCourse();
      const u2 = seedStudent("u2@example.com");
      rateCourse(base.user.id, base.course.id, 2);
      rateCourse(u2.id, base.course.id, 4); // course 1 avg 3
      rateCourse(base.user.id, second.id, 5); // course 2 avg 5

      const map = getAverageRatingsForCourses([base.course.id, second.id]);
      expect(map.get(base.course.id)).toEqual({ average: 3, count: 2 });
      expect(map.get(second.id)).toEqual({ average: 5, count: 1 });
    });
  });
});
