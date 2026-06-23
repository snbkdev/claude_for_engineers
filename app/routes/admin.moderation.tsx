import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import * as v from "valibot";
import type { Route } from "./+types/admin.moderation";
import {
  getCoursesPendingReview,
  getLessonCountForCourse,
} from "~/services/courseService";
import { approveCourse, rejectCourse } from "~/services/moderationService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { parseFormData } from "~/lib/validation";
import { UserRole } from "~/db/schema";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, BookOpen, Check, ShieldCheck, X } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";

const moderationActionSchema = v.variant("intent", [
  v.object({
    intent: v.literal("approve"),
    courseId: v.pipe(v.string(), v.transform(Number), v.integer()),
  }),
  v.object({
    intent: v.literal("reject"),
    courseId: v.pipe(v.string(), v.transform(Number), v.integer()),
    reason: v.pipe(
      v.string(),
      v.trim(),
      v.minLength(1, "A rejection reason is required.")
    ),
  }),
]);

export function meta() {
  return [
    { title: "Moderation — Cadence" },
    { name: "description", content: "Review courses awaiting moderation" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to moderate courses.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  const pending = getCoursesPendingReview().map((course) => ({
    ...course,
    lessonCount: getLessonCountForCourse(course.id),
  }));

  return { courses: pending };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = getUserById(currentUserId);
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can moderate courses.", { status: 403 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, moderationActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent } = parsed.data;

  if (intent === "approve") {
    const result = approveCourse(parsed.data.courseId);
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    return { success: true };
  }

  if (intent === "reject") {
    const result = rejectCourse({
      courseId: parsed.data.courseId,
      reason: parsed.data.reason,
    });
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    return { success: true };
  }

  throw data("Invalid action.", { status: 400 });
}

function CourseRow({
  course,
}: {
  course: {
    id: number;
    title: string;
    slug: string;
    instructorId: number;
    instructorName: string;
    updatedAt: string;
    lessonCount: number;
  };
}) {
  const fetcher = useFetcher();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Course moderated.");
      setRejecting(false);
      setReason("");
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  const submitting = fetcher.state !== "idle";

  const formattedDate = new Date(course.updatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  function approve() {
    fetcher.submit(
      { intent: "approve", courseId: String(course.id) },
      { method: "post" }
    );
  }

  function reject() {
    if (!reason.trim()) {
      toast.error("Enter a rejection reason.");
      return;
    }
    fetcher.submit(
      { intent: "reject", courseId: String(course.id), reason },
      { method: "post" }
    );
  }

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-4 py-3">
        <div>
          <Link
            to={`/courses/${course.slug}`}
            className="text-sm font-medium hover:underline"
          >
            {course.title}
          </Link>
          <p className="text-xs text-muted-foreground">{course.slug}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        <Link to={`/u/${course.instructorId}`} className="hover:underline">
          {course.instructorName}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BookOpen className="size-3.5" />
          {course.lessonCount}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formattedDate}
      </td>
      <td className="px-4 py-3">
        {rejecting ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection"
              className="h-8 w-56 text-xs"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={reject}
                disabled={submitting}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={approve} disabled={submitting}>
              <Check className="mr-1 size-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejecting(true)}
              disabled={submitting}
            >
              <X className="mr-1 size-3.5" />
              Reject
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function HeaderRow() {
  return (
    <tr className="border-b border-border bg-muted/50">
      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Course
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Instructor
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Lessons
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Submitted
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Actions
      </th>
    </tr>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <HeaderRow />
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Skeleton className="mb-1 h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-8" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-8 w-40" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminModeration({ loaderData }: Route.ComponentProps) {
  const { courses } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Moderation</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Moderation</h1>
        <p className="mt-1 text-muted-foreground">
          Review published courses awaiting approval
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4" />
        <span>
          {courses.length} {courses.length === 1 ? "course" : "courses"}{" "}
          awaiting review
        </span>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ShieldCheck className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              Nothing to review. The queue is clear.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <HeaderRow />
                </thead>
                <tbody>
                  {courses.map((course) => (
                    <CourseRow key={course.id} course={course} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading the moderation queue.";

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
          : "Only admins can access this page.";
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
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
