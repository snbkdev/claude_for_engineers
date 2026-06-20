import { eq, and, desc } from "drizzle-orm";
import { db } from "~/db";
import { lessonNotes, lessons, modules, courses } from "~/db/schema";

// ─── Note Service ───
// Private per-student notes on individual lessons. Every query is scoped to the
// owning user — notes are never shared. Functions with multiple same-typed params
// take a single object param.

export function getNotesForLesson(opts: { userId: number; lessonId: number }) {
  return db
    .select()
    .from(lessonNotes)
    .where(
      and(
        eq(lessonNotes.userId, opts.userId),
        eq(lessonNotes.lessonId, opts.lessonId)
      )
    )
    .orderBy(desc(lessonNotes.createdAt), desc(lessonNotes.id))
    .all();
}

export function getNoteById(id: number) {
  return db.select().from(lessonNotes).where(eq(lessonNotes.id, id)).get();
}

export function createNote(opts: {
  userId: number;
  lessonId: number;
  content: string;
}) {
  const trimmed = opts.content.trim();
  if (!trimmed) {
    throw new Error("Note cannot be empty");
  }

  return db
    .insert(lessonNotes)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      content: trimmed,
    })
    .returning()
    .get();
}

export function updateNote(opts: { id: number; content: string }) {
  const trimmed = opts.content.trim();
  if (!trimmed) {
    throw new Error("Note cannot be empty");
  }

  return db
    .update(lessonNotes)
    .set({ content: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(lessonNotes.id, opts.id))
    .returning()
    .get();
}

export function deleteNote(id: number) {
  return db.delete(lessonNotes).where(eq(lessonNotes.id, id)).returning().get();
}

// All of a user's notes across every lesson, newest-edited first, joined with
// lesson + course context for the "My Notes" page (grouping + deep links).
export function getNotesForUser(userId: number) {
  return db
    .select({
      id: lessonNotes.id,
      content: lessonNotes.content,
      updatedAt: lessonNotes.updatedAt,
      lessonId: lessonNotes.lessonId,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseSlug: courses.slug,
      courseTitle: courses.title,
    })
    .from(lessonNotes)
    .innerJoin(lessons, eq(lessonNotes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessonNotes.userId, userId))
    .orderBy(desc(lessonNotes.updatedAt), desc(lessonNotes.id))
    .all();
}
