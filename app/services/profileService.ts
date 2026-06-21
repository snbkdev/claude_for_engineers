import { getUserById } from "./userService";
import { getCoursesByInstructor } from "./courseService";
import { getAverageRatingsForCourses } from "./ratingService";
import { getEnrollmentCountForCourse } from "./enrollmentService";
import {
  computeAchievementStats,
  getAchievementShowcase,
  type AchievementShowcaseEntry,
} from "./achievementService";
import { getCompletionDatesForUser } from "./progressService";
import {
  computeXp,
  levelFromXp,
  currentDailyStreak,
  longestDailyStreak,
} from "~/lib/gamification";
import { CourseStatus, UserRole } from "~/db/schema";

// ─── Profile Service ───
// Assembles a public-facing profile for a user. Instructors show their published
// courses + ratings; students show level/XP/badges, gated by the leaderboard
// opt-out (reused as the profile-privacy flag). Pure assembly over existing
// services so it stays test-isolatable through the shared db mock.

export interface ProfileUser {
  id: number;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
}

export interface InstructorCourseSummary {
  id: number;
  title: string;
  slug: string;
  coverImageUrl: string | null;
  rating: number | null;
  ratingCount: number;
  enrollmentCount: number;
}

export interface InstructorProfile {
  courses: InstructorCourseSummary[];
  courseCount: number;
  totalStudents: number;
  averageRating: number | null; // weighted across rated courses
}

export interface StudentProfile {
  level: number;
  xp: number;
  completedCourses: number;
  completedLessons: number;
  currentStreak: number;
  longestStreak: number;
  badges: AchievementShowcaseEntry[]; // earned only
}

export interface Profile {
  user: ProfileUser;
  instructor: InstructorProfile | null;
  student: StudentProfile | null;
  // True when the user is a student who opted out of public stats.
  studentPrivate: boolean;
}

function buildInstructorProfile(instructorId: number): InstructorProfile {
  const published = getCoursesByInstructor(instructorId).filter(
    (c) => c.status === CourseStatus.Published
  );
  const ratings = getAverageRatingsForCourses(published.map((c) => c.id));

  const courses: InstructorCourseSummary[] = published.map((c) => {
    const r = ratings.get(c.id);
    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      coverImageUrl: c.coverImageUrl,
      rating: r?.average ?? null,
      ratingCount: r?.count ?? 0,
      enrollmentCount: getEnrollmentCountForCourse(c.id),
    };
  });

  const totalStudents = courses.reduce((sum, c) => sum + c.enrollmentCount, 0);

  // Weighted mean of course averages by rating count.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of courses) {
    if (c.rating !== null && c.ratingCount > 0) {
      weightedSum += c.rating * c.ratingCount;
      weightTotal += c.ratingCount;
    }
  }
  const averageRating =
    weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : null;

  return {
    courses,
    courseCount: courses.length,
    totalStudents,
    averageRating,
  };
}

function buildStudentProfile(userId: number): StudentProfile {
  const stats = computeAchievementStats(userId);
  const xp = computeXp({
    completedLessons: stats.completedLessons,
    completedCourses: stats.completedCourses,
  });
  const dates = getCompletionDatesForUser(userId);

  return {
    level: levelFromXp(xp).level,
    xp,
    completedCourses: stats.completedCourses,
    completedLessons: stats.completedLessons,
    currentStreak: currentDailyStreak(dates),
    longestStreak: longestDailyStreak(dates),
    badges: getAchievementShowcase(userId).filter((b) => b.earned),
  };
}

export function getProfile(userId: number): Profile | null {
  const user = getUserById(userId);
  if (!user) return null;

  const profileUser: ProfileUser = {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    role: user.role,
  };

  const isInstructor = user.role === UserRole.Instructor;
  const isStudent = user.role === UserRole.Student;
  const studentPrivate = isStudent && user.leaderboardOptOut;

  return {
    user: profileUser,
    instructor: isInstructor ? buildInstructorProfile(user.id) : null,
    student: isStudent && !studentPrivate ? buildStudentProfile(user.id) : null,
    studentPrivate,
  };
}
