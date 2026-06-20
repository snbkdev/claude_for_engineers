import { Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { getUserEnrolledCourses } from "~/services/enrollmentService";
import {
  calculateProgress,
  getCompletedLessonCount,
  getTotalLessonCount,
  getNextIncompleteLesson,
} from "~/services/progressService";
import { getCurrentUserId } from "~/lib/session";
import { getUsersByRole } from "~/services/userService";
import { getUserCertificates } from "~/services/certificateService";
import { UserRole } from "~/db/schema";
import { computeXp, levelFromXp } from "~/lib/gamification";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  PlayCircle,
  Sparkles,
  Trophy,
} from "lucide-react";
import { CourseImage } from "~/components/course-image";
import { data, isRouteErrorResponse } from "react-router";

export function meta() {
  return [
    { title: "Dashboard — Cadence" },
    { name: "description", content: "Your enrolled courses and progress" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your dashboard.", {
      status: 401,
    });
  }

  const enrolledCourses = getUserEnrolledCourses(currentUserId);

  // Map courseId → certificate code for "View certificate" links.
  const certificateByCourse = new Map(
    getUserCertificates(currentUserId).map((c) => [c.courseId, c.code])
  );

  const coursesWithProgress = enrolledCourses.map((enrollment) => {
    const progress = calculateProgress({
      userId: currentUserId,
      courseId: enrollment.courseId,
      includeQuizzes: false,
      weightByDuration: false,
    });
    const completedLessons = getCompletedLessonCount({
      userId: currentUserId,
      courseId: enrollment.courseId,
    });
    const totalLessons = getTotalLessonCount(enrollment.courseId);
    const nextLesson = getNextIncompleteLesson({
      userId: currentUserId,
      courseId: enrollment.courseId,
    });
    const isCompleted = enrollment.completedAt !== null;

    return {
      ...enrollment,
      progress,
      completedLessons,
      totalLessons,
      nextLessonId: nextLesson?.id ?? null,
      isCompleted,
      certificateCode: certificateByCourse.get(enrollment.courseId) ?? null,
    };
  });

  const completedCourses = coursesWithProgress.filter((c) => c.isCompleted);
  const inProgressCourses = coursesWithProgress.filter((c) => !c.isCompleted);

  // ─── Gamification (derived from progress, no schema) ───
  const totalCompletedLessons = coursesWithProgress.reduce(
    (sum, c) => sum + c.completedLessons,
    0
  );
  const totalXp = computeXp({
    completedLessons: totalCompletedLessons,
    completedCourses: completedCourses.length,
  });
  const level = levelFromXp(totalXp);

  // A few other learners' avatars (decorative "fellow learners" cluster).
  const otherLearners = getUsersByRole(UserRole.Student)
    .filter((u) => u.id !== currentUserId && u.avatarUrl)
    .slice(0, 5)
    .map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl }));

  return { inProgressCourses, completedCourses, level, otherLearners };
}

// Stable colored banner per course (matching the dashboard reference UI).
// blue → TypeScript-ish, green → Node-ish, then more for variety.
const COURSE_BANNERS = [
  "from-blue-500 to-blue-700",
  "from-emerald-500 to-green-700",
  "from-violet-500 to-fuchsia-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-700",
];

function courseBanner(courseId: number): string {
  // 1-based offset so course #1 → blue, #2 → green (matches the reference UI).
  const idx =
    (((courseId - 1) % COURSE_BANNERS.length) + COURSE_BANNERS.length) %
    COURSE_BANNERS.length;
  return COURSE_BANNERS[idx];
}

type LevelInfo = ReturnType<typeof levelFromXp>;
interface Learner {
  id: number;
  name: string;
  avatarUrl: string | null;
}

function LevelHeader({
  level,
  otherLearners,
}: {
  level: LevelInfo;
  otherLearners: Learner[];
}) {
  return (
    <Card className="mb-8 overflow-hidden border-0 bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500 text-white shadow-lg">
      <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        {/* Level + XP */}
        <div className="flex flex-1 items-center gap-4">
          <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur">
            <Trophy className="size-5" />
            <span className="text-lg font-bold leading-none">
              {level.level}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold uppercase tracking-wider text-white/80">
                Level {level.level}
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-white/80">
                <Sparkles className="size-3.5" />
                {level.totalXp} XP
              </span>
            </div>
            <div className="mt-2 h-2.5 w-full max-w-md overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: `${level.progressPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-white/80">
              {level.xpToNextLevel} XP to level {level.level + 1}
            </p>
          </div>
        </div>

        {/* Fellow learners */}
        {otherLearners.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {otherLearners.map((learner) => (
                <img
                  key={learner.id}
                  src={learner.avatarUrl ?? undefined}
                  alt={learner.name}
                  title={learner.name}
                  className="size-9 rounded-full bg-white/90 ring-2 ring-violet-500"
                />
              ))}
            </div>
            <span className="text-xs text-white/80">Fellow learners</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardCardSkeleton() {
  return (
    <Card className="flex flex-col">
      <Skeleton className="aspect-video rounded-b-none rounded-t-lg" />
      <CardHeader>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
      </CardHeader>
      <CardContent className="flex-1">
        <div className="mb-2 flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-10" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-10 w-full" />
      </CardFooter>
    </Card>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-5 w-64" />
      </div>
      <Skeleton className="mb-8 h-28 w-full rounded-xl" />
      <Skeleton className="mb-4 h-6 w-32" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <DashboardCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { inProgressCourses, completedCourses, level, otherLearners } =
    loaderData;
  const totalCourses = inProgressCourses.length + completedCourses.length;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Dashboard</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Track your learning progress
        </p>
      </div>

      <LevelHeader level={level} otherLearners={otherLearners} />

      {totalCourses === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GraduationCap className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No enrolled courses</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the catalog to find courses and start learning.
          </p>
          <Link to="/courses" className="mt-4">
            <Button>Browse Courses</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* In Progress Courses */}
          {inProgressCourses.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">In Progress</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {inProgressCourses.map((course) => (
                  <Card
                    key={course.enrollmentId}
                    className="flex flex-col overflow-hidden pt-0"
                  >
                    <Link
                      to={`/courses/${course.courseSlug}`}
                      className={`flex aspect-video items-center justify-center bg-gradient-to-br p-6 transition-transform hover:scale-[1.02] ${courseBanner(course.courseId)}`}
                    >
                      <span className="line-clamp-3 text-center text-xl font-bold leading-tight text-white drop-shadow-sm">
                        {course.courseTitle}
                      </span>
                    </Link>
                    <CardHeader>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {course.courseDescription}
                      </p>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {course.completedLessons} / {course.totalLessons}{" "}
                          lessons
                        </span>
                        <span className="font-medium">{course.progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${course.progress}%` }}
                        />
                      </div>
                    </CardContent>
                    <CardFooter>
                      {course.nextLessonId ? (
                        <Link
                          to={`/courses/${course.courseSlug}/lessons/${course.nextLessonId}`}
                          className="w-full"
                        >
                          <Button className="w-full" variant="outline">
                            <PlayCircle className="mr-2 size-4" />
                            Continue Learning
                          </Button>
                        </Link>
                      ) : (
                        <Link
                          to={`/courses/${course.courseSlug}`}
                          className="w-full"
                        >
                          <Button className="w-full" variant="outline">
                            <BookOpen className="mr-2 size-4" />
                            View Course
                          </Button>
                        </Link>
                      )}
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Completed Courses */}
          {completedCourses.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Completed</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {completedCourses.map((course) => (
                  <Card
                    key={course.enrollmentId}
                    className="flex flex-col overflow-hidden pt-0"
                  >
                    <Link
                      to={`/courses/${course.courseSlug}`}
                      className="relative aspect-video overflow-hidden"
                    >
                      <CourseImage
                        src={course.coverImageUrl}
                        alt={course.courseTitle}
                        className="h-full w-full object-cover transition-transform hover:scale-105"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <CheckCircle2 className="size-12 text-white" />
                      </div>
                    </Link>
                    <CardHeader>
                      <Link
                        to={`/courses/${course.courseSlug}`}
                        className="text-lg font-semibold leading-tight hover:text-primary"
                      >
                        {course.courseTitle}
                      </Link>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {course.courseDescription}
                      </p>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle2 className="size-4" />
                        <span>Completed — {course.totalLessons} lessons</span>
                      </div>
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      {course.certificateCode && (
                        <Link
                          to={`/certificates/${course.certificateCode}`}
                          className="w-full"
                        >
                          <Button className="w-full">
                            <Award className="mr-2 size-4" />
                            View Certificate
                          </Button>
                        </Link>
                      )}
                      <Link
                        to={`/courses/${course.courseSlug}`}
                        className="w-full"
                      >
                        <Button className="w-full" variant="outline">
                          <BookOpen className="mr-2 size-4" />
                          Review Course
                        </Button>
                      </Link>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your dashboard.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
