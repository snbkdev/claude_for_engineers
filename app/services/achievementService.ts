import { and, eq, gte } from "drizzle-orm";
import { db } from "~/db";
import {
  achievements,
  lessonProgress,
  enrollments,
  quizAttempts,
  LessonProgressStatus,
} from "~/db/schema";
import { longestDailyStreak } from "~/lib/gamification";

// ─── Achievement Service ───
// Discrete badges layered on top of the XP/level system. The *catalog* of
// definitions (title, description, icon, unlock rule) lives here in code; only
// *earned* rows are persisted, so adding a new badge needs no migration. A
// single evaluator recomputes every rule from current progress and
// idempotently awards any newly-satisfied badge (check-then-insert, no DB
// unique constraint). Functions with multiple same-typed params take an object.

// Raw figures every unlock rule is derived from.
export interface AchievementStats {
  completedLessons: number;
  completedCourses: number;
  aceQuizzes: number; // distinct quizzes with an A-grade attempt
  longestStreak: number; // longest run of consecutive active days
}

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  icon: string; // lucide-react icon name, mapped in the UI
  isEarned: (stats: AchievementStats) => boolean;
}

// A-grade threshold mirrors quizScoringService.calculateGrade ("A" >= 0.9).
export const QUIZ_ACE_SCORE = 0.9;
export const STREAK_ACHIEVEMENT_DAYS = 7;

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: "first-lesson",
    title: "First Steps",
    description: "Complete your first lesson.",
    icon: "Footprints",
    isEarned: (s) => s.completedLessons >= 1,
  },
  {
    key: "first-course",
    title: "Course Graduate",
    description: "Complete your first course.",
    icon: "GraduationCap",
    isEarned: (s) => s.completedCourses >= 1,
  },
  {
    key: "five-courses",
    title: "Scholar",
    description: "Complete five courses.",
    icon: "Library",
    isEarned: (s) => s.completedCourses >= 5,
  },
  {
    key: "quiz-ace",
    title: "Quiz Ace",
    description: "Score an A on a quiz.",
    icon: "Target",
    isEarned: (s) => s.aceQuizzes >= 1,
  },
  {
    key: "quiz-master",
    title: "Quiz Master",
    description: "Score an A on five quizzes.",
    icon: "Crown",
    isEarned: (s) => s.aceQuizzes >= 5,
  },
  {
    key: "streak-7",
    title: "On Fire",
    description: "Learn seven days in a row.",
    icon: "Flame",
    isEarned: (s) => s.longestStreak >= STREAK_ACHIEVEMENT_DAYS,
  },
];

const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export function getAchievementDef(key: string): AchievementDef | undefined {
  return ACHIEVEMENT_BY_KEY.get(key);
}

// Gather the raw stats every rule is computed from.
export function computeAchievementStats(userId: number): AchievementStats {
  const completedProgress = db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .all();

  const userEnrollments = db
    .select()
    .from(enrollments)
    .where(eq(enrollments.userId, userId))
    .all();
  const completedCourses = userEnrollments.filter(
    (e) => e.completedAt !== null
  ).length;

  const aceRows = db
    .selectDistinct({ quizId: quizAttempts.quizId })
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, userId),
        gte(quizAttempts.score, QUIZ_ACE_SCORE)
      )
    )
    .all();

  return {
    completedLessons: completedProgress.length,
    completedCourses,
    aceQuizzes: aceRows.length,
    longestStreak: longestDailyStreak(
      completedProgress.map((p) => p.completedAt)
    ),
  };
}

function getEarnedKeys(userId: number): Set<string> {
  const rows = db
    .select({ key: achievements.key })
    .from(achievements)
    .where(eq(achievements.userId, userId))
    .all();
  return new Set(rows.map((r) => r.key));
}

export interface EarnedAchievement {
  key: string;
  title: string;
  description: string;
  icon: string;
}

// Recompute every rule and award any newly-satisfied badge (idempotent).
// Returns the definitions of badges earned *by this call*, for a toast.
export function evaluateAchievements(opts: {
  userId: number;
}): EarnedAchievement[] {
  const { userId } = opts;
  const stats = computeAchievementStats(userId);
  const earned = getEarnedKeys(userId);

  const newlyEarned: EarnedAchievement[] = [];
  for (const def of ACHIEVEMENTS) {
    if (earned.has(def.key)) continue;
    if (!def.isEarned(stats)) continue;
    db.insert(achievements).values({ userId, key: def.key }).run();
    newlyEarned.push({
      key: def.key,
      title: def.title,
      description: def.description,
      icon: def.icon,
    });
  }
  return newlyEarned;
}

export interface AchievementShowcaseEntry {
  key: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
}

// All catalog entries (in catalog order) with earned status, for the showcase.
export function getAchievementShowcase(
  userId: number
): AchievementShowcaseEntry[] {
  const rows = db
    .select()
    .from(achievements)
    .where(eq(achievements.userId, userId))
    .all();
  const earnedAtByKey = new Map(rows.map((r) => [r.key, r.earnedAt]));

  return ACHIEVEMENTS.map((def) => ({
    key: def.key,
    title: def.title,
    description: def.description,
    icon: def.icon,
    earned: earnedAtByKey.has(def.key),
    earnedAt: earnedAtByKey.get(def.key) ?? null,
  }));
}
