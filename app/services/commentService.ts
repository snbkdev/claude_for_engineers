import { eq, and, asc } from "drizzle-orm";
import { db } from "~/db";
import { lessonComments, users } from "~/db/schema";

// ─── Comment Service ───
// Handles lesson comments. Students who own a course leave top-level comments;
// instructors (and authors) reply via parentId. Replies are one level deep.
// Uses positional parameters (project convention).

export type LessonCommentWithUser = {
  id: number;
  lessonId: number;
  userId: number;
  parentId: number | null;
  content: string;
  createdAt: string;
  userName: string;
  userAvatarUrl: string | null;
  userRole: string;
};

export function getCommentsForLesson(lessonId: number) {
  return db
    .select({
      id: lessonComments.id,
      lessonId: lessonComments.lessonId,
      userId: lessonComments.userId,
      parentId: lessonComments.parentId,
      content: lessonComments.content,
      createdAt: lessonComments.createdAt,
      userName: users.name,
      userAvatarUrl: users.avatarUrl,
      userRole: users.role,
    })
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(eq(lessonComments.lessonId, lessonId))
    .orderBy(asc(lessonComments.createdAt))
    .all();
}

export function getCommentById(id: number) {
  return db
    .select()
    .from(lessonComments)
    .where(eq(lessonComments.id, id))
    .get();
}

export function createComment(
  userId: number,
  lessonId: number,
  content: string,
  parentId: number | null
) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Comment cannot be empty");
  }

  // Replies may only attach to a top-level comment on the same lesson.
  if (parentId !== null) {
    const parent = getCommentById(parentId);
    if (!parent || parent.lessonId !== lessonId) {
      throw new Error("Parent comment not found on this lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Cannot reply to a reply");
    }
  }

  return db
    .insert(lessonComments)
    .values({ userId, lessonId, content: trimmed, parentId })
    .returning()
    .get();
}

export function deleteComment(id: number) {
  // Remove any replies first so we never orphan a child comment.
  db.delete(lessonComments).where(eq(lessonComments.parentId, id)).run();

  return db
    .delete(lessonComments)
    .where(eq(lessonComments.id, id))
    .returning()
    .get();
}

// Groups flat comment rows into top-level comments each carrying their replies,
// preserving the chronological order produced by getCommentsForLesson.
export function buildCommentTree(rows: LessonCommentWithUser[]) {
  const repliesByParent = new Map<number, LessonCommentWithUser[]>();
  for (const row of rows) {
    if (row.parentId !== null) {
      const list = repliesByParent.get(row.parentId) ?? [];
      list.push(row);
      repliesByParent.set(row.parentId, list);
    }
  }

  return rows
    .filter((row) => row.parentId === null)
    .map((row) => ({
      ...row,
      replies: repliesByParent.get(row.id) ?? [],
    }));
}
