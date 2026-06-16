import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "~/db";
import { bookmarks, courses, lessons, modules, users } from "~/db/schema";

// ─── Bookmark Service ───
// Lets a user save a course (wishlist) or a lesson to return to later.
// Each bookmark row sets exactly one of courseId / lessonId.
// Functions with multiple same-typed params take a single object param.

export function findCourseBookmark(opts: { userId: number; courseId: number }) {
  return db
    .select()
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.userId, opts.userId),
        eq(bookmarks.courseId, opts.courseId)
      )
    )
    .get();
}

export function findLessonBookmark(opts: { userId: number; lessonId: number }) {
  return db
    .select()
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.userId, opts.userId),
        eq(bookmarks.lessonId, opts.lessonId)
      )
    )
    .get();
}

export function isCourseBookmarked(opts: { userId: number; courseId: number }) {
  return !!findCourseBookmark(opts);
}

export function isLessonBookmarked(opts: { userId: number; lessonId: number }) {
  return !!findLessonBookmark(opts);
}

export function removeCourseBookmark(opts: {
  userId: number;
  courseId: number;
}) {
  return db
    .delete(bookmarks)
    .where(
      and(
        eq(bookmarks.userId, opts.userId),
        eq(bookmarks.courseId, opts.courseId)
      )
    )
    .run();
}

export function removeLessonBookmark(opts: {
  userId: number;
  lessonId: number;
}) {
  return db
    .delete(bookmarks)
    .where(
      and(
        eq(bookmarks.userId, opts.userId),
        eq(bookmarks.lessonId, opts.lessonId)
      )
    )
    .run();
}

// Adds the bookmark if missing, removes it if present.
// Returns whether the course is bookmarked after the toggle.
export function toggleCourseBookmark(opts: {
  userId: number;
  courseId: number;
}) {
  if (findCourseBookmark(opts)) {
    removeCourseBookmark(opts);
    return { bookmarked: false };
  }

  db.insert(bookmarks)
    .values({ userId: opts.userId, courseId: opts.courseId })
    .run();
  return { bookmarked: true };
}

export function toggleLessonBookmark(opts: {
  userId: number;
  lessonId: number;
}) {
  if (findLessonBookmark(opts)) {
    removeLessonBookmark(opts);
    return { bookmarked: false };
  }

  db.insert(bookmarks)
    .values({ userId: opts.userId, lessonId: opts.lessonId })
    .run();
  return { bookmarked: true };
}

export function getBookmarkedCourses(userId: number) {
  return db
    .select({
      bookmarkId: bookmarks.id,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      courseDescription: courses.description,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
      bookmarkedAt: bookmarks.createdAt,
    })
    .from(bookmarks)
    .innerJoin(courses, eq(bookmarks.courseId, courses.id))
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(and(eq(bookmarks.userId, userId), isNull(bookmarks.lessonId)))
    .orderBy(desc(bookmarks.createdAt))
    .all();
}

export function getBookmarkedLessons(userId: number) {
  return db
    .select({
      bookmarkId: bookmarks.id,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      bookmarkedAt: bookmarks.createdAt,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(eq(bookmarks.userId, userId), isNull(bookmarks.courseId)))
    .orderBy(desc(bookmarks.createdAt))
    .all();
}
