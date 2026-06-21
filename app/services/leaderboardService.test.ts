import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus, UserRole } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getLeaderboard } from "./leaderboardService";

let emailSeq = 0;
function addStudent(name: string): number {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `s${emailSeq++}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get().id;
}

function addLesson(): number {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "M", position: 0 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "L", position: 0 })
    .returning()
    .get().id;
}

function completeLessons(userId: number, count: number, completedAt: string) {
  for (let i = 0; i < count; i++) {
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId,
        lessonId: addLesson(),
        status: LessonProgressStatus.Completed,
        completedAt,
      })
      .run();
  }
}

function completeCourse(userId: number, completedAt: string) {
  const course = testDb
    .insert(schema.courses)
    .values({
      title: `C${emailSeq++}`,
      slug: `c-${emailSeq}`,
      description: "d",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: course.id, completedAt })
    .run();
}

const NOW = new Date("2026-06-20T12:00:00.000Z");
const RECENT = "2026-06-19T12:00:00.000Z"; // within 7 days
const OLD = "2026-06-01T12:00:00.000Z"; // > 7 days ago

describe("leaderboardService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    emailSeq = 0;
  });

  describe("getLeaderboard (all-time)", () => {
    it("ranks students by XP descending and flags the current user", () => {
      const a = addStudent("Alice");
      const b = addStudent("Bob");

      completeLessons(a, 3, RECENT); // 30 XP
      completeLessons(b, 1, RECENT); // 10
      completeCourse(b, RECENT); // +50 → 60 XP
      // base.user has no progress → 0 XP

      const board = getLeaderboard({
        period: "all-time",
        currentUserId: base.user.id,
        now: NOW,
      });

      expect(board.map((e) => e.name)).toEqual(["Bob", "Alice", "Test User"]);
      expect(board.map((e) => e.xp)).toEqual([60, 30, 0]);
      expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);

      const self = board.find((e) => e.isCurrentUser)!;
      expect(self.userId).toBe(base.user.id);
    });

    it("excludes non-students (instructors)", () => {
      const board = getLeaderboard({ period: "all-time", now: NOW });
      expect(board.some((e) => e.userId === base.instructor.id)).toBe(false);
    });

    it("uses competition ranking for ties (1, 1, 3)", () => {
      const a = addStudent("Aaa");
      const b = addStudent("Bbb");
      const c = addStudent("Ccc");
      completeLessons(a, 2, RECENT); // 20
      completeLessons(b, 2, RECENT); // 20
      completeLessons(c, 1, RECENT); // 10

      const board = getLeaderboard({ period: "all-time", now: NOW });
      const ranked = board.filter((e) => e.xp > 0);
      expect(ranked.map((e) => [e.name, e.rank])).toEqual([
        ["Aaa", 1],
        ["Bbb", 1],
        ["Ccc", 3],
      ]);
    });
  });

  describe("getLeaderboard (weekly)", () => {
    it("counts only completions within the last 7 days", () => {
      const a = addStudent("Alice");
      completeLessons(a, 2, RECENT); // counts
      completeLessons(a, 3, OLD); // ignored this week

      const weekly = getLeaderboard({ period: "weekly", now: NOW });
      const alistWeekly = weekly.find((e) => e.name === "Alice")!;
      expect(alistWeekly.xp).toBe(20);

      const allTime = getLeaderboard({ period: "all-time", now: NOW });
      const aliceAll = allTime.find((e) => e.name === "Alice")!;
      expect(aliceAll.xp).toBe(50);
    });
  });

  describe("privacy", () => {
    it("excludes opted-out students from the board", () => {
      const a = addStudent("Alice");
      const b = addStudent("Bob");
      completeLessons(a, 3, RECENT);
      completeLessons(b, 1, RECENT);

      testDb
        .update(schema.users)
        .set({ leaderboardOptOut: true })
        .where(eq(schema.users.id, a))
        .run();

      const board = getLeaderboard({ period: "all-time", now: NOW });
      expect(board.some((e) => e.userId === a)).toBe(false);
      expect(board.some((e) => e.userId === b)).toBe(true);
    });
  });
});
