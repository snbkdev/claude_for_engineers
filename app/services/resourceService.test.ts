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
  getResourcesForLesson,
  getResourceById,
  createResource,
  deleteResource,
} from "./resourceService";

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

describe("resourceService", () => {
  let lessonId: number;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    lessonId = addLesson();
  });

  describe("createResource", () => {
    it("creates a trimmed resource", () => {
      const r = createResource({
        lessonId,
        title: "  Slides  ",
        url: "  https://example.com/s.pdf  ",
        type: "  pdf  ",
      });
      expect(r.title).toBe("Slides");
      expect(r.url).toBe("https://example.com/s.pdf");
      expect(r.type).toBe("pdf");
    });

    it("stores null type when blank", () => {
      const r = createResource({
        lessonId,
        title: "Link",
        url: "https://example.com",
        type: "   ",
      });
      expect(r.type).toBeNull();
    });

    it("throws on empty title or url", () => {
      expect(() =>
        createResource({ lessonId, title: "  ", url: "https://x.com" })
      ).toThrowError("Resource title cannot be empty");
      expect(() =>
        createResource({ lessonId, title: "T", url: "  " })
      ).toThrowError("Resource URL cannot be empty");
    });
  });

  describe("getResourcesForLesson", () => {
    it("returns the lesson's resources in creation order, scoped by lesson", () => {
      const other = addLesson("Lesson 2");
      createResource({ lessonId, title: "A", url: "https://a.com" });
      createResource({ lessonId, title: "B", url: "https://b.com" });
      createResource({ lessonId: other, title: "C", url: "https://c.com" });

      const list = getResourcesForLesson(lessonId);
      expect(list.map((r) => r.title)).toEqual(["A", "B"]);
    });
  });

  describe("deleteResource", () => {
    it("removes the resource", () => {
      const r = createResource({ lessonId, title: "A", url: "https://a.com" });
      deleteResource(r.id);
      expect(getResourceById(r.id)).toBeUndefined();
    });
  });
});
