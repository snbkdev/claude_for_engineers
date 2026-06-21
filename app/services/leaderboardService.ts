import { eq, and, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  users,
  lessonProgress,
  enrollments,
  UserRole,
  LessonProgressStatus,
} from "~/db/schema";
import { computeXp, levelFromXp } from "~/lib/gamification";

// ─── Leaderboard Service ───
// Ranks students by XP (derived from progress) for a competitive board. XP is
// computed the same way as the dashboard (computeXp/levelFromXp), so no points
// are stored. Two windows: "all-time" (every completion) and "weekly" (the last
// 7 days). Opted-out students are excluded. Functions with multiple same-typed
// params take a single object param.

export type LeaderboardPeriod = "weekly" | "all-time";

export interface LeaderboardEntry {
  userId: number;
  name: string;
  avatarUrl: string | null;
  completedLessons: number;
  completedCourses: number;
  xp: number;
  level: number;
  rank: number; // competition ranking — equal XP shares a rank
  isCurrentUser: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function periodCutoff(period: LeaderboardPeriod, now: Date): string | null {
  if (period === "all-time") return null;
  return new Date(now.getTime() - WEEK_MS).toISOString();
}

// userId → completed-lesson count (optionally only since `cutoff`).
function completedLessonsByUser(cutoff: string | null): Map<number, number> {
  const conditions = [
    eq(lessonProgress.status, LessonProgressStatus.Completed),
  ];
  if (cutoff) conditions.push(gte(lessonProgress.completedAt, cutoff));

  const rows = db
    .select({
      userId: lessonProgress.userId,
      count: sql<number>`count(*)`,
    })
    .from(lessonProgress)
    .where(and(...conditions))
    .groupBy(lessonProgress.userId)
    .all();
  return new Map(rows.map((r) => [r.userId, r.count]));
}

// userId → completed-course count (optionally only since `cutoff`).
function completedCoursesByUser(cutoff: string | null): Map<number, number> {
  const conditions = [isNotNull(enrollments.completedAt)];
  if (cutoff) conditions.push(gte(enrollments.completedAt, cutoff));

  const rows = db
    .select({
      userId: enrollments.userId,
      count: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(and(...conditions))
    .groupBy(enrollments.userId)
    .all();
  return new Map(rows.map((r) => [r.userId, r.count]));
}

export function getLeaderboard(opts: {
  period: LeaderboardPeriod;
  currentUserId?: number | null;
  now?: Date;
}): LeaderboardEntry[] {
  const now = opts.now ?? new Date();
  const cutoff = periodCutoff(opts.period, now);

  const students = db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(
      and(eq(users.role, UserRole.Student), eq(users.leaderboardOptOut, false))
    )
    .all();

  const lessonsByUser = completedLessonsByUser(cutoff);
  const coursesByUser = completedCoursesByUser(cutoff);

  const scored = students.map((s) => {
    const completedLessons = lessonsByUser.get(s.id) ?? 0;
    const completedCourses = coursesByUser.get(s.id) ?? 0;
    const xp = computeXp({ completedLessons, completedCourses });
    return {
      ...s,
      completedLessons,
      completedCourses,
      xp,
      level: levelFromXp(xp).level,
    };
  });

  // Highest XP first; ties broken by name for a stable order.
  scored.sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));

  const entries: LeaderboardEntry[] = [];
  let rank = 0;
  let prevXp: number | null = null;
  scored.forEach((s, index) => {
    if (prevXp === null || s.xp !== prevXp) {
      rank = index + 1; // competition ranking (1, 2, 2, 4, …)
      prevXp = s.xp;
    }
    entries.push({
      userId: s.id,
      name: s.name,
      avatarUrl: s.avatarUrl,
      completedLessons: s.completedLessons,
      completedCourses: s.completedCourses,
      xp: s.xp,
      level: s.level,
      rank,
      isCurrentUser: opts.currentUserId != null && s.id === opts.currentUserId,
    });
  });
  return entries;
}
