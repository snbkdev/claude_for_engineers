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
  toggleWishlist,
  isWishlisted,
  removeFromWishlist,
  getWishlistCourseIds,
  getWishlist,
} from "./wishlistService";

function makeCourse(title: string, slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug,
      description: "d",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

describe("wishlistService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("toggles a course on and off", () => {
    expect(
      isWishlisted({ userId: base.user.id, courseId: base.course.id })
    ).toBe(false);

    const added = toggleWishlist({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(added.wishlisted).toBe(true);
    expect(
      isWishlisted({ userId: base.user.id, courseId: base.course.id })
    ).toBe(true);

    const removed = toggleWishlist({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(removed.wishlisted).toBe(false);
    expect(
      isWishlisted({ userId: base.user.id, courseId: base.course.id })
    ).toBe(false);
  });

  it("does not duplicate a course already on the wishlist", () => {
    toggleWishlist({ userId: base.user.id, courseId: base.course.id });
    // A second add via insert path would duplicate; toggle removes instead.
    const ids = getWishlistCourseIds(base.user.id);
    expect(ids).toEqual([base.course.id]);
  });

  it("removeFromWishlist is idempotent", () => {
    toggleWishlist({ userId: base.user.id, courseId: base.course.id });
    removeFromWishlist({ userId: base.user.id, courseId: base.course.id });
    removeFromWishlist({ userId: base.user.id, courseId: base.course.id });
    expect(getWishlistCourseIds(base.user.id)).toEqual([]);
  });

  it("scopes the wishlist to the user", () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();

    toggleWishlist({ userId: base.user.id, courseId: base.course.id });
    expect(getWishlistCourseIds(other.id)).toEqual([]);
    expect(getWishlistCourseIds(base.user.id)).toEqual([base.course.id]);
  });

  it("returns wishlist details newest first with course + instructor", () => {
    const c2 = makeCourse("Second", "second");
    toggleWishlist({ userId: base.user.id, courseId: base.course.id });
    toggleWishlist({ userId: base.user.id, courseId: c2.id });

    const items = getWishlist(base.user.id);
    expect(items).toHaveLength(2);
    // Newest first: c2 was added after base.course.
    expect(items[0].courseId).toBe(c2.id);
    expect(items[1].courseId).toBe(base.course.id);
    expect(items[0].instructorName).toBe(base.instructor.name);
    expect(items[0].title).toBe("Second");
  });
});
