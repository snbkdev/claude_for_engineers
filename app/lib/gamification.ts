// ─── Gamification ───
//
// Pure, DB-free helpers that turn a learner's progress into XP and a level.
// XP is *derived* from existing progress data (no schema/migration): each
// completed lesson and each finished course is worth a fixed number of points.
// Levels are evenly spaced every `XP_PER_LEVEL` points so the dashboard can
// render a "progress toward next level" bar.

export const XP_PER_LESSON = 10;
export const XP_PER_COURSE = 50;
export const XP_PER_LEVEL = 100;

/** Total XP from completed lessons + finished courses. Never negative. */
export function computeXp(opts: {
  completedLessons: number;
  completedCourses: number;
}): number {
  const lessons = Math.max(0, Math.floor(opts.completedLessons));
  const courses = Math.max(0, Math.floor(opts.completedCourses));
  return lessons * XP_PER_LESSON + courses * XP_PER_COURSE;
}

export interface LevelInfo {
  /** 1-based level. */
  level: number;
  /** Total XP accumulated. */
  totalXp: number;
  /** XP earned within the current level (0 … XP_PER_LEVEL). */
  xpIntoLevel: number;
  /** XP needed to finish the current level. */
  xpForLevel: number;
  /** XP remaining until the next level. */
  xpToNextLevel: number;
  /** Progress through the current level, 0–100 (integer). */
  progressPct: number;
}

/** Map a total XP figure to a level and progress within that level. */
export function levelFromXp(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;
  const xpToNextLevel = XP_PER_LEVEL - xpIntoLevel;
  const progressPct = Math.round((xpIntoLevel / XP_PER_LEVEL) * 100);

  return {
    level,
    totalXp: xp,
    xpIntoLevel,
    xpForLevel: XP_PER_LEVEL,
    xpToNextLevel,
    progressPct,
  };
}
