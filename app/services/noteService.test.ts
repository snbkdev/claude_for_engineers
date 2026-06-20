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
  getNotesForLesson,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  getNotesForUser,
} from "./noteService";

// Adds a lesson under a module on the seeded course and returns its id.
function addLesson(title = "Lesson 1"): number {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 0 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title, position: 0 })
    .returning()
    .get().id;
}

describe("noteService", () => {
  let lessonId: number;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    lessonId = addLesson();
  });

  describe("createNote", () => {
    it("creates a trimmed note", () => {
      const note = createNote({
        userId: base.user.id,
        lessonId,
        content: "  hello  ",
      });

      expect(note.userId).toBe(base.user.id);
      expect(note.lessonId).toBe(lessonId);
      expect(note.content).toBe("hello");
    });

    it("throws on an empty/whitespace note", () => {
      expect(() =>
        createNote({ userId: base.user.id, lessonId, content: "   " })
      ).toThrowError("Note cannot be empty");
    });
  });

  describe("updateNote", () => {
    it("updates the content", () => {
      const note = createNote({
        userId: base.user.id,
        lessonId,
        content: "first",
      });
      const updated = updateNote({ id: note.id, content: "second" });
      expect(updated.content).toBe("second");
    });

    it("throws when updating to empty", () => {
      const note = createNote({
        userId: base.user.id,
        lessonId,
        content: "first",
      });
      expect(() => updateNote({ id: note.id, content: "  " })).toThrowError(
        "Note cannot be empty"
      );
    });
  });

  describe("deleteNote", () => {
    it("removes the note", () => {
      const note = createNote({
        userId: base.user.id,
        lessonId,
        content: "bye",
      });
      deleteNote(note.id);
      expect(getNoteById(note.id)).toBeUndefined();
    });
  });

  describe("getNotesForLesson", () => {
    it("returns only the given user's notes, newest first", () => {
      createNote({ userId: base.user.id, lessonId, content: "a" });
      createNote({ userId: base.user.id, lessonId, content: "b" });
      // Another user's note on the same lesson must not leak.
      createNote({ userId: base.instructor.id, lessonId, content: "other" });

      const notes = getNotesForLesson({ userId: base.user.id, lessonId });
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => n.userId === base.user.id)).toBe(true);
      // desc by createdAt → most recently created first.
      expect(notes[0].content).toBe("b");
    });
  });

  describe("getNotesForUser", () => {
    it("returns the user's notes with lesson + course context", () => {
      createNote({ userId: base.user.id, lessonId, content: "note" });
      createNote({ userId: base.instructor.id, lessonId, content: "other" });

      const rows = getNotesForUser(base.user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        content: "note",
        lessonId,
        courseSlug: base.course.slug,
        courseTitle: base.course.title,
      });
      expect(rows[0].lessonTitle).toBeTruthy();
    });
  });
});
