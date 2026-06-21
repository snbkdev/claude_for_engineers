import { eq, and, asc, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { lessonComments, commentReactions, users } from "~/db/schema";

// ─── Comment Service ───
// Handles lesson comments. Students who own a course leave top-level comments;
// instructors (and authors) reply via parentId. Replies are one level deep.
// Top-level comments may be flagged as questions (Q&A view). Comments carry
// up/down votes ("most helpful" sort). Functions with multiple same-typed params
// take a single object param.

export type LessonCommentWithUser = {
  id: number;
  lessonId: number;
  userId: number;
  parentId: number | null;
  content: string;
  isQuestion: boolean;
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
      isQuestion: lessonComments.isQuestion,
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

export function createComment(opts: {
  userId: number;
  lessonId: number;
  content: string;
  parentId: number | null;
  isQuestion?: boolean;
}) {
  const trimmed = opts.content.trim();
  if (!trimmed) {
    throw new Error("Comment cannot be empty");
  }

  // Replies may only attach to a top-level comment on the same lesson.
  if (opts.parentId !== null) {
    const parent = getCommentById(opts.parentId);
    if (!parent || parent.lessonId !== opts.lessonId) {
      throw new Error("Parent comment not found on this lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Cannot reply to a reply");
    }
  }

  // Only top-level comments can be questions.
  const isQuestion =
    opts.parentId === null ? (opts.isQuestion ?? false) : false;

  return db
    .insert(lessonComments)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      content: trimmed,
      parentId: opts.parentId,
      isQuestion,
    })
    .returning()
    .get();
}

export function deleteComment(id: number) {
  // Remove reactions on this comment and its replies, then the replies, so we
  // never orphan a child comment or a dangling reaction.
  const replyIds = db
    .select({ id: lessonComments.id })
    .from(lessonComments)
    .where(eq(lessonComments.parentId, id))
    .all()
    .map((r) => r.id);

  const allIds = [id, ...replyIds];
  db.delete(commentReactions)
    .where(inArray(commentReactions.commentId, allIds))
    .run();

  db.delete(lessonComments).where(eq(lessonComments.parentId, id)).run();

  return db
    .delete(lessonComments)
    .where(eq(lessonComments.id, id))
    .returning()
    .get();
}

// ─── Reactions (up/down votes) ───

// Applies a vote (+1 or −1) by `userId` to `commentId`. Clicking the same
// direction again removes the vote (toggle); the opposite direction switches it.
// Returns the user's resulting vote (1, -1, or 0).
export function voteOnComment(opts: {
  commentId: number;
  userId: number;
  value: 1 | -1;
}): number {
  const existing = db
    .select()
    .from(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, opts.commentId),
        eq(commentReactions.userId, opts.userId)
      )
    )
    .get();

  if (!existing) {
    db.insert(commentReactions)
      .values({
        commentId: opts.commentId,
        userId: opts.userId,
        value: opts.value,
      })
      .run();
    return opts.value;
  }

  if (existing.value === opts.value) {
    // Same direction → remove the vote.
    db.delete(commentReactions)
      .where(eq(commentReactions.id, existing.id))
      .run();
    return 0;
  }

  db.update(commentReactions)
    .set({ value: opts.value })
    .where(eq(commentReactions.id, existing.id))
    .run();
  return opts.value;
}

// commentId → net score (sum of votes) for the given comments.
export function getCommentScores(commentIds: number[]): Map<number, number> {
  if (commentIds.length === 0) return new Map();
  const rows = db
    .select({
      commentId: commentReactions.commentId,
      score: sql<number>`coalesce(sum(${commentReactions.value}), 0)`,
    })
    .from(commentReactions)
    .where(inArray(commentReactions.commentId, commentIds))
    .groupBy(commentReactions.commentId)
    .all();
  return new Map(rows.map((r) => [r.commentId, r.score]));
}

// commentId → the user's own vote (1 or -1) for the given comments.
export function getUserVotes(opts: {
  userId: number;
  commentIds: number[];
}): Map<number, number> {
  if (opts.commentIds.length === 0) return new Map();
  const rows = db
    .select({
      commentId: commentReactions.commentId,
      value: commentReactions.value,
    })
    .from(commentReactions)
    .where(
      and(
        eq(commentReactions.userId, opts.userId),
        inArray(commentReactions.commentId, opts.commentIds)
      )
    )
    .all();
  return new Map(rows.map((r) => [r.commentId, r.value]));
}

// Groups flat comment rows into top-level comments each carrying their replies,
// preserving the chronological order produced by getCommentsForLesson. Generic
// over the row shape so callers can pass vote-enriched rows.
export function buildCommentTree<
  T extends { id: number; parentId: number | null },
>(rows: T[]): Array<T & { replies: T[] }> {
  const repliesByParent = new Map<number, T[]>();
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
