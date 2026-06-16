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
      const comment = createComment(
        base.user.id,
        lesson.id,
        "Great lesson!",
        null
      );

      expect(comment.id).toBeDefined();
      expect(comment.parentId).toBeNull();
      expect(comment.content).toBe("Great lesson!");
    });

    it("trims whitespace and rejects empty content", () => {
      const lesson = seedLesson();
      const comment = createComment(base.user.id, lesson.id, "  hi  ", null);
      expect(comment.content).toBe("hi");

      expect(() =>
        createComment(base.user.id, lesson.id, "   ", null)
      ).toThrow();
    });

    it("creates a reply attached to a top-level comment", () => {
      const lesson = seedLesson();
      const parent = createComment(base.user.id, lesson.id, "Question?", null);
      const reply = createComment(
        base.instructor.id,
        lesson.id,
        "Answer.",
        parent.id
      );

      expect(reply.parentId).toBe(parent.id);
    });

    it("rejects a reply to a comment on a different lesson", () => {
      const lessonA = seedLesson();
      const lessonB = seedLesson();
      const parent = createComment(base.user.id, lessonA.id, "On A", null);

      expect(() =>
        createComment(base.instructor.id, lessonB.id, "Wrong lesson", parent.id)
      ).toThrow();
    });

    it("rejects replying to a reply", () => {
      const lesson = seedLesson();
      const parent = createComment(base.user.id, lesson.id, "Question?", null);
      const reply = createComment(
        base.instructor.id,
        lesson.id,
        "Answer.",
        parent.id
      );

      expect(() =>
        createComment(base.user.id, lesson.id, "Thanks!", reply.id)
      ).toThrow();
    });
  });

  describe("getCommentsForLesson", () => {
    it("returns comments joined with author details, oldest first", () => {
      const lesson = seedLesson();
      createComment(base.user.id, lesson.id, "First", null);
      createComment(base.instructor.id, lesson.id, "Second", null);

      const rows = getCommentsForLesson(lesson.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].content).toBe("First");
      expect(rows[0].userName).toBe(base.user.name);
      expect(rows[0].userRole).toBe(base.user.role);
    });

    it("only returns comments for the requested lesson", () => {
      const lessonA = seedLesson();
      const lessonB = seedLesson();
      createComment(base.user.id, lessonA.id, "On A", null);

      expect(getCommentsForLesson(lessonB.id)).toHaveLength(0);
    });
  });

  describe("buildCommentTree", () => {
    it("nests replies under their parent comment", () => {
      const lesson = seedLesson();
      const parent = createComment(base.user.id, lesson.id, "Question?", null);
      createComment(base.instructor.id, lesson.id, "Answer.", parent.id);
      createComment(base.user.id, lesson.id, "Another top-level", null);

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
      const parent = createComment(base.user.id, lesson.id, "Question?", null);
      const reply = createComment(
        base.instructor.id,
        lesson.id,
        "Answer.",
        parent.id
      );

      deleteComment(parent.id);

      expect(getCommentById(parent.id)).toBeUndefined();
      expect(getCommentById(reply.id)).toBeUndefined();
    });
  });
});
