import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCoursesByInstructor, getAllCourses } from "~/services/courseService";
import { getRevenueSummary } from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, DollarSign } from "lucide-react";
import { formatCents } from "~/lib/utils";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Revenue analytics for your courses" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can access analytics.", {
      status: 403,
    });
  }

  // The route decides scope; the service is auth-agnostic.
  const isAdmin = user.role === UserRole.Admin;
  const courseIds = (
    isAdmin ? getAllCourses() : getCoursesByInstructor(currentUserId)
  ).map((course) => course.id);

  const summary = getRevenueSummary({ courseIds });

  return {
    scope: isAdmin ? ("platform" as const) : ("instructor" as const),
    totalRevenue: summary.totalRevenue,
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-5 w-72" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { scope, totalRevenue } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          {scope === "platform"
            ? "Platform-wide revenue across all courses"
            : "Revenue across all your courses"}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Total revenue
            </span>
            <DollarSign className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCents(totalRevenue)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
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
