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

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamps → set of distinct UTC day strings (YYYY-MM-DD). */
function toUtcDaySet(isoTimestamps: Array<string | null>): Set<string> {
  const days = new Set<string>();
  for (const ts of isoTimestamps) {
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    days.add(d.toISOString().slice(0, 10));
  }
  return days;
}

function dayString(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Longest run of consecutive calendar days (UTC) present in a list of ISO
 * timestamps. Days are deduped, so several activities on one day count once.
 * Used to award the "learn N days in a row" achievement; because it measures
 * the *longest* historical run (not the current streak), the badge is earned
 * the first time the evaluator sees a 7-day run and never lost afterwards.
 */
export function longestDailyStreak(
  isoTimestamps: Array<string | null>
): number {
  const days = toUtcDaySet(isoTimestamps);
  if (days.size === 0) return 0;

  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = Date.parse(sorted[i - 1]);
    const curr = Date.parse(sorted[i]);
    if (curr - prev === DAY_MS) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
}

/**
 * Current streak: the number of consecutive active days ending today. The
 * streak is considered "alive" if the most recent activity was today or
 * yesterday (so it doesn't break the moment a new UTC day starts before the
 * user logs in); if the last active day is two or more days ago it is 0.
 * `now` is injectable for deterministic tests.
 */
export function currentDailyStreak(
  isoTimestamps: Array<string | null>,
  now: Date = new Date()
): number {
  const days = toUtcDaySet(isoTimestamps);
  if (days.size === 0) return 0;

  const todayMs = Date.parse(dayString(now.getTime()));
  let cursor = todayMs;
  if (!days.has(dayString(cursor))) {
    // Not active today — the streak can still be alive from yesterday.
    cursor -= DAY_MS;
    if (!days.has(dayString(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayString(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
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
