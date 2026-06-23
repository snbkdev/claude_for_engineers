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

import { parseQuery, scoreEntity, makeSnippet, search } from "./searchService";

describe("parseQuery", () => {
  it("lowercases, splits on whitespace, trims, dedupes, drops empties", () => {
    expect(parseQuery("  React   REACT  hooks ")).toEqual(["react", "hooks"]);
  });

  it("returns an empty array for a blank query", () => {
    expect(parseQuery("   ")).toEqual([]);
  });
});

describe("scoreEntity", () => {
  const fields = [
    { text: "JavaScript Basics", weight: 5 },
    { text: "Learn variables and loops", weight: 2 },
  ];

  it("requires every term to match (AND semantics)", () => {
    expect(scoreEntity(fields, ["javascript", "missing"])).toBeNull();
  });

  it("sums the heaviest field each term appears in", () => {
    // "javascript" → title (5); "loops" → body (2)
    expect(scoreEntity(fields, ["javascript", "loops"])).toBe(7);
  });

  it("uses the heaviest field when a term is in several", () => {
    const f = [
      { text: "loops", weight: 5 },
      { text: "loops everywhere", weight: 2 },
    ];
    expect(scoreEntity(f, ["loops"])).toBe(5);
  });

  it("returns null for no terms", () => {
    expect(scoreEntity(fields, [])).toBeNull();
  });
});

describe("makeSnippet", () => {
  it("returns the cleaned text when short enough", () => {
    expect(makeSnippet("a  b\nc", ["b"], 160)).toBe("a b c");
  });

  it("windows around the first matched term with ellipses", () => {
    const text = "x".repeat(100) + " needle " + "y".repeat(100);
    const snip = makeSnippet(text, ["needle"], 80);
    expect(snip).toContain("needle");
    expect(snip.startsWith("…")).toBe(true);
    expect(snip.endsWith("…")).toBe(true);
    expect(snip.length).toBeLessThan(text.length);
  });

  it("falls back to a head slice when no term matches", () => {
    const text = "z".repeat(300);
    const snip = makeSnippet(text, ["nope"], 80);
    expect(snip.endsWith("…")).toBe(true);
    expect(snip.length).toBeLessThanOrEqual(81);
  });
});

describe("search (integration)", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  function makeModuleAndLesson(opts: { title: string; content: string }) {
    const mod = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module 1", position: 1 })
      .returning()
      .get();
    return testDb
      .insert(schema.lessons)
      .values({
        moduleId: mod.id,
        title: opts.title,
        content: opts.content,
        position: 1,
      })
      .returning()
      .get();
  }

  it("returns empty results for a blank query", () => {
    const r = search("   ");
    expect(r.total).toBe(0);
    expect(r.terms).toEqual([]);
  });

  it("finds a published course by title", () => {
    const r = search("test course");
    expect(r.courses.map((c) => c.id)).toContain(base.course.id);
  });

  it("excludes draft courses", () => {
    const draft = testDb
      .insert(schema.courses)
      .values({
        title: "Secret Draft Course",
        slug: "secret-draft",
        description: "hidden",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Draft,
      })
      .returning()
      .get();

    const r = search("secret draft");
    expect(r.courses.find((c) => c.id === draft.id)).toBeUndefined();
  });

  it("finds a lesson by content and builds a snippet", () => {
    const lesson = makeModuleAndLesson({
      title: "Intro",
      content: "This lesson covers closures in depth.",
    });
    const r = search("closures");
    const hit = r.lessons.find((l) => l.id === lesson.id);
    expect(hit).toBeDefined();
    expect(hit!.courseSlug).toBe(base.course.slug);
    expect(hit!.snippet.toLowerCase()).toContain("closures");
  });

  it("finds an author by name", () => {
    const r = search("Test Instructor");
    expect(r.authors.map((a) => a.id)).toContain(base.instructor.id);
  });

  it("does not return students as authors", () => {
    const r = search("Test User");
    expect(r.authors.find((a) => a.id === base.user.id)).toBeUndefined();
  });

  it("applies AND across terms", () => {
    // "test" matches the course, but "nonexistentword" matches nothing.
    const r = search("test nonexistentword");
    expect(r.total).toBe(0);
  });
});
