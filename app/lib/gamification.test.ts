import { describe, it, expect } from "vitest";
import {
  computeXp,
  levelFromXp,
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
