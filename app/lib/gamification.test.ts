import { describe, it, expect } from "vitest";
import {
  computeXp,
  levelFromXp,
  longestDailyStreak,
  XP_PER_LESSON,
  XP_PER_COURSE,
  XP_PER_LEVEL,
} from "./gamification";

describe("computeXp", () => {
  it("sums lesson and course points", () => {
    expect(computeXp({ completedLessons: 3, completedCourses: 2 })).toBe(
      3 * XP_PER_LESSON + 2 * XP_PER_COURSE
    );
  });

  it("is zero with no progress", () => {
    expect(computeXp({ completedLessons: 0, completedCourses: 0 })).toBe(0);
  });

  it("clamps negative or fractional inputs", () => {
    expect(computeXp({ completedLessons: -5, completedCourses: 1.9 })).toBe(
      XP_PER_COURSE
    );
  });
});

describe("levelFromXp", () => {
  it("starts at level 1 with no XP", () => {
    const info = levelFromXp(0);
    expect(info.level).toBe(1);
    expect(info.xpIntoLevel).toBe(0);
    expect(info.progressPct).toBe(0);
    expect(info.xpToNextLevel).toBe(XP_PER_LEVEL);
  });

  it("advances a level exactly at the threshold", () => {
    const info = levelFromXp(XP_PER_LEVEL);
    expect(info.level).toBe(2);
    expect(info.xpIntoLevel).toBe(0);
  });

  it("reports partial progress within a level", () => {
    const info = levelFromXp(XP_PER_LEVEL + 30);
    expect(info.level).toBe(2);
    expect(info.xpIntoLevel).toBe(30);
    expect(info.progressPct).toBe(30);
    expect(info.xpToNextLevel).toBe(XP_PER_LEVEL - 30);
  });

  it("clamps negative XP to level 1", () => {
    expect(levelFromXp(-100).level).toBe(1);
  });
});

describe("longestDailyStreak", () => {
  it("is zero with no timestamps", () => {
    expect(longestDailyStreak([])).toBe(0);
    expect(longestDailyStreak([null, null])).toBe(0);
  });

  it("counts a single active day as 1", () => {
    expect(longestDailyStreak(["2026-06-01T10:00:00.000Z"])).toBe(1);
  });

  it("dedupes multiple activities on the same day", () => {
    expect(
      longestDailyStreak([
        "2026-06-01T08:00:00.000Z",
        "2026-06-01T20:00:00.000Z",
      ])
    ).toBe(1);
  });

  it("finds the longest run of consecutive days, ignoring gaps", () => {
    const dates = [
      "2026-06-01T10:00:00.000Z",
      "2026-06-02T10:00:00.000Z",
      "2026-06-03T10:00:00.000Z",
      // gap on the 4th
      "2026-06-05T10:00:00.000Z",
      "2026-06-06T10:00:00.000Z",
    ];
    expect(longestDailyStreak(dates)).toBe(3);
  });

  it("detects a 7-day run regardless of input order", () => {
    const days = [6, 0, 2, 4, 1, 5, 3].map(
      (d) => `2026-06-0${d + 1}T12:00:00.000Z`
    );
    expect(longestDailyStreak(days)).toBe(7);
  });

  it("skips unparseable timestamps", () => {
    expect(longestDailyStreak(["not-a-date", "2026-06-01T10:00:00.000Z"])).toBe(
      1
    );
  });
});
