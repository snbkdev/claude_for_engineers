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
  getCommentsForLesson,
  getCommentById,
  createComment,
  deleteComment,
  buildCommentTree,
} from "./commentService";

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

describe("commentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("createComment", () => {
    it("creates a top-level comment", () => {
      const lesson = seedLesson();
      const comment = createComment({ userId: base.user.id, lessonId: lesson.id, content: "Great lesson!", parentId: null });

      expect(comment.id).toBeDefined();
      expect(comment.parentId).toBeNull();
      expect(comment.content).toBe("Great lesson!");
    });

    it("trims whitespace and rejects empty content", () => {
      const lesson = seedLesson();
      const comment = createComment({ userId: base.user.id, lessonId: lesson.id, content: "  hi  ", parentId: null });
      expect(comment.content).toBe("hi");

      expect(() =>
        createComment({ userId: base.user.id, lessonId: lesson.id, content: "   ", parentId: null })
      ).toThrow();
    });

    it("creates a reply attached to a top-level comment", () => {
      const lesson = seedLesson();
      const parent = createComment({ userId: base.user.id, lessonId: lesson.id, content: "Question?", parentId: null });
      const reply = createComment({ userId: base.instructor.id, lessonId: lesson.id, content: "Answer.", parentId: parent.id });

      expect(reply.parentId).toBe(parent.id);
    });

    it("rejects a reply to a comment on a different lesson", () => {
      const lessonA = seedLesson();
      const lessonB = seedLesson();
      const parent = createComment({ userId: base.user.id, lessonId: lessonA.id, content: "On A", parentId: null });

      expect(() =>
        createComment({ userId: base.instructor.id, lessonId: lessonB.id, content: "Wrong lesson", parentId: parent.id })
      ).toThrow();
    });

    it("rejects replying to a reply", () => {
      const lesson = seedLesson();
      const parent = createComment({ userId: base.user.id, lessonId: lesson.id, content: "Question?", parentId: null });
      const reply = createComment({ userId: base.instructor.id, lessonId: lesson.id, content: "Answer.", parentId: parent.id });

      expect(() =>
        createComment({ userId: base.user.id, lessonId: lesson.id, content: "Thanks!", parentId: reply.id })
      ).toThrow();
    });
  });

  describe("getCommentsForLesson", () => {
    it("returns comments joined with author details, oldest first", () => {
      const lesson = seedLesson();
      createComment({ userId: base.user.id, lessonId: lesson.id, content: "First", parentId: null });
      createComment({ userId: base.instructor.id, lessonId: lesson.id, content: "Second", parentId: null });

      const rows = getCommentsForLesson(lesson.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].content).toBe("First");
      expect(rows[0].userName).toBe(base.user.name);
      expect(rows[0].userRole).toBe(base.user.role);
    });

    it("only returns comments for the requested lesson", () => {
      const lessonA = seedLesson();
      const lessonB = seedLesson();
      createComment({ userId: base.user.id, lessonId: lessonA.id, content: "On A", parentId: null });

      expect(getCommentsForLesson(lessonB.id)).toHaveLength(0);
    });
  });

  describe("buildCommentTree", () => {
    it("nests replies under their parent comment", () => {
      const lesson = seedLesson();
      const parent = createComment({ userId: base.user.id, lessonId: lesson.id, content: "Question?", parentId: null });
      createComment({ userId: base.instructor.id, lessonId: lesson.id, content: "Answer.", parentId: parent.id });
      createComment({ userId: base.user.id, lessonId: lesson.id, content: "Another top-level", parentId: null });

      const tree = buildCommentTree(getCommentsForLesson(lesson.id));
      expect(tree).toHaveLength(2);
      expect(tree[0].replies).toHaveLength(1);
      expect(tree[0].replies[0].content).toBe("Answer.");
      expect(tree[1].replies).toHaveLength(0);
    });
  });

  describe("deleteComment", () => {
    it("deletes a comment and cascades to its replies", () => {
      const lesson = seedLesson();
      const parent = createComment({ userId: base.user.id, lessonId: lesson.id, content: "Question?", parentId: null });
      const reply = createComment({ userId: base.instructor.id, lessonId: lesson.id, content: "Answer.", parentId: parent.id });

      deleteComment(parent.id);

      expect(getCommentById(parent.id)).toBeUndefined();
      expect(getCommentById(reply.id)).toBeUndefined();
    });
  });
});
