import { describe, it, expect } from "vitest";
import { computeUnlockedLessonIds, isLessonUnlocked } from "./drip";

describe("computeUnlockedLessonIds", () => {
  const order = [10, 20, 30, 40];

  it("unlocks only the first lesson when nothing is completed", () => {
    const unlocked = computeUnlockedLessonIds(order, new Set());
    expect([...unlocked]).toEqual([10]);
  });

  it("unlocks through the first incomplete lesson as progress is made", () => {
    const unlocked = computeUnlockedLessonIds(order, new Set([10]));
    expect([...unlocked].sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it("unlocks all lessons once every lesson is completed", () => {
    const unlocked = computeUnlockedLessonIds(order, new Set([10, 20, 30, 40]));
    expect([...unlocked].sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it("treats a gap (later completed, earlier not) as blocking at the first hole", () => {
    // 10 done, 20 not done, 30 done out of order → unlocked is 10, 20 only.
    const unlocked = computeUnlockedLessonIds(order, new Set([10, 30]));
    expect([...unlocked].sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it("returns an empty set for an empty curriculum", () => {
    expect(computeUnlockedLessonIds([], new Set([1, 2])).size).toBe(0);
  });
});

describe("isLessonUnlocked", () => {
  const order = [1, 2, 3];

  it("is true for the first incomplete lesson", () => {
    expect(isLessonUnlocked(1, order, new Set())).toBe(true);
    expect(isLessonUnlocked(2, order, new Set([1]))).toBe(true);
  });

  it("is false for a lesson past the first incomplete one", () => {
    expect(isLessonUnlocked(3, order, new Set())).toBe(false);
    expect(isLessonUnlocked(3, order, new Set([1]))).toBe(false);
  });

  it("is false for a lesson not in the curriculum", () => {
    expect(isLessonUnlocked(99, order, new Set([1, 2, 3]))).toBe(false);
  });
});
