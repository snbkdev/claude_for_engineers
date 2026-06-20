import { eq, asc } from "drizzle-orm";
import { db } from "~/db";
import { lessonResources } from "~/db/schema";

// ─── Resource Service ───
// Lesson attachments/resources (slides, source, links) managed by the
// instructor. Functions with multiple same-typed params take a single object.

export function getResourcesForLesson(lessonId: number) {
  return db
    .select()
    .from(lessonResources)
    .where(eq(lessonResources.lessonId, lessonId))
    .orderBy(asc(lessonResources.id))
    .all();
}

export function getResourceById(id: number) {
  return db
    .select()
    .from(lessonResources)
    .where(eq(lessonResources.id, id))
    .get();
}

export function createResource(opts: {
  lessonId: number;
  title: string;
  url: string;
  type?: string | null;
}) {
  const title = opts.title.trim();
  const url = opts.url.trim();
  if (!title) {
    throw new Error("Resource title cannot be empty");
  }
  if (!url) {
    throw new Error("Resource URL cannot be empty");
  }
  const type = opts.type?.trim() || null;

  return db
    .insert(lessonResources)
    .values({ lessonId: opts.lessonId, title, url, type })
    .returning()
    .get();
}

export function deleteResource(id: number) {
  return db
    .delete(lessonResources)
    .where(eq(lessonResources.id, id))
    .returning()
    .get();
}
