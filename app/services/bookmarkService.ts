import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { lessonBookmarks, lessons, modules } from "~/db/schema";

// ─── Bookmark Service ───
// Private per-student bookmarks on individual lessons. They persist until the
// student removes them (even after the lesson is completed).
// Functions with multiple same-typed params take a single object param.

function findBookmark(opts: { userId: number; lessonId: number }) {
  return db
    .select()
    .from(lessonBookmarks)
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(lessonBookmarks.lessonId, opts.lessonId)
      )
    )
    .get();
}

export function isLessonBookmarked(opts: { userId: number; lessonId: number }) {
  return !!findBookmark(opts);
}

// Adds the bookmark if missing, removes it if present.
// Returns whether the lesson is bookmarked after the toggle.
export function toggleBookmark(opts: { userId: number; lessonId: number }) {
  if (findBookmark(opts)) {
    db.delete(lessonBookmarks)
      .where(
        and(
          eq(lessonBookmarks.userId, opts.userId),
          eq(lessonBookmarks.lessonId, opts.lessonId)
        )
      )
      .run();
    return { bookmarked: false };
  }

  db.insert(lessonBookmarks)
    .values({ userId: opts.userId, lessonId: opts.lessonId })
    .run();
  return { bookmarked: true };
}

// All lesson IDs the user has bookmarked within a given course. Used by loaders
// to batch-load bookmark state for the curriculum sidebar and course detail.
export function getBookmarkedLessonIds(opts: {
  userId: number;
  courseId: number;
}) {
  return db
    .select({ lessonId: lessonBookmarks.lessonId })
    .from(lessonBookmarks)
    .innerJoin(lessons, eq(lessonBookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(modules.courseId, opts.courseId)
      )
    )
    .all()
    .map((row) => row.lessonId);
}
