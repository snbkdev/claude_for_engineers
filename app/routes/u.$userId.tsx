import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/u.$userId";
import { getCurrentUserId } from "~/lib/session";
import { getProfile } from "~/services/profileService";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/user-avatar";
import { CourseImage } from "~/components/course-image";
import { cn } from "~/lib/utils";
import {
  AlertTriangle,
  Award,
  BookOpen,
  Crown,
  Flame,
  Footprints,
  GraduationCap,
  Library,
  Lock,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const name = loaderData?.profile?.user.name ?? "Profile";
  return [{ title: `${name} — Cadence` }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view profiles.", {
      status: 401,
    });
  }

  const userId = Number(params.userId);
  if (isNaN(userId)) {
    throw data("Invalid profile", { status: 400 });
  }

  const profile = getProfile(userId);
  if (!profile) {
    throw data("Profile not found", { status: 404 });
  }

  return { profile };
}

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  Footprints,
  GraduationCap,
  Library,
  Target,
  Crown,
  Flame,
};

function roleLabel(role: string): string {
  if (role === "instructor") return "Instructor";
  if (role === "admin") return "Admin";
  return "Student";
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="mt-6 h-64 w-full rounded-xl" />
    </div>
  );
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData;
  const { user, instructor, student, studentPrivate } = profile;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      {/* Header */}
      <Card className="mb-6 overflow-hidden border-0 bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500 text-white shadow-lg">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
          <UserAvatar
            name={user.name}
            avatarUrl={user.avatarUrl}
            className="size-20 ring-4 ring-white/30"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{user.name}</h1>
            <span className="mt-1 inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-white/25">
              {roleLabel(user.role)}
            </span>
            {user.bio && (
              <p className="mt-3 text-sm text-white/90">{user.bio}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Instructor: courses + ratings */}
      {instructor && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-4">
            <StatCard
              icon={<BookOpen className="size-5" />}
              value={instructor.courseCount}
              label="Courses"
            />
            <StatCard
              icon={<Users className="size-5" />}
              value={instructor.totalStudents}
              label="Students"
            />
            <StatCard
              icon={<Star className="size-5" />}
              value={instructor.averageRating ?? "—"}
              label="Avg rating"
            />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Courses</h2>
            </CardHeader>
            <CardContent>
              {instructor.courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No published courses yet.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {instructor.courses.map((course) => (
                    <Link
                      key={course.id}
                      to={`/courses/${course.slug}`}
                      className="flex gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <CourseImage
                        src={course.coverImageUrl}
                        alt={course.title}
                        className="h-16 w-24 shrink-0 rounded-md object-cover"
                      />
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-medium leading-tight">
                          {course.title}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Star className="size-3.5 text-amber-500" />
                            {course.rating !== null
                              ? `${course.rating} (${course.ratingCount})`
                              : "No ratings"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="size-3.5" />
                            {course.enrollmentCount}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Student: level/XP + badges */}
      {student && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              icon={<Trophy className="size-5" />}
              value={student.level}
              label="Level"
            />
            <StatCard
              icon={<Sparkles className="size-5" />}
              value={student.xp}
              label="XP"
            />
            <StatCard
              icon={<GraduationCap className="size-5" />}
              value={student.completedCourses}
              label="Courses done"
            />
            <StatCard
              icon={<Flame className="size-5" />}
              value={student.longestStreak}
              label="Best streak"
            />
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <Award className="size-5 text-violet-500" />
                <h2 className="text-lg font-semibold">Achievements</h2>
              </div>
              <span className="text-sm text-muted-foreground">
                {student.badges.length} earned
              </span>
            </CardHeader>
            <CardContent>
              {student.badges.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No badges earned yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {student.badges.map((b) => {
                    const Icon = ACHIEVEMENT_ICONS[b.icon] ?? Award;
                    return (
                      <div
                        key={b.key}
                        title={b.description}
                        className="flex flex-col items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-4 text-center dark:border-violet-900 dark:bg-violet-950/40"
                      >
                        <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                          <Icon className="size-6" />
                        </div>
                        <div>
                          <p className="text-sm font-medium leading-tight">
                            {b.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {b.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Private student */}
      {studentPrivate && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Lock className="size-10 text-muted-foreground/60" />
            <h2 className="text-lg font-medium">This profile is private</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {user.name} has chosen to keep their learning stats private.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Admin / no extra sections */}
      {!instructor && !student && !studentPrivate && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing more to show here.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
        <div className="text-violet-500">{icon}</div>
        <span className="text-xl font-bold">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this profile.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Profile not found";
      message = "This user doesn't exist.";
    } else if (error.status === 401) {
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
        <Link to="/dashboard" className="text-sm text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
