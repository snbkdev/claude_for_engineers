import { Link, useFetcher } from "react-router";
import { z } from "zod";
import { data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/bookmarks";
import { getCurrentUserId } from "~/lib/session";
import {
  getBookmarkedCourses,
  getBookmarkedLessons,
  removeCourseBookmark,
  removeLessonBookmark,
} from "~/services/bookmarkService";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { CourseImage } from "~/components/course-image";
import { parseFormData } from "~/lib/validation";
import {
  AlertTriangle,
  Bookmark,
  BookOpen,
  PlayCircle,
  X,
} from "lucide-react";

export function meta() {
  return [
    { title: "Bookmarks — Cadence" },
    { name: "description", content: "Courses and lessons you've saved" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your bookmarks.", {
      status: 401,
    });
  }

  return {
    courses: getBookmarkedCourses(currentUserId),
    lessons: getBookmarkedLessons(currentUserId),
  };
}

const bookmarkActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("remove-course"),
    courseId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("remove-lesson"),
    lessonId: z.coerce.number().int(),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Sign in required", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, bookmarkActionSchema);
  if (!parsed.success) {
    throw data("Invalid action", { status: 400 });
  }

  if (parsed.data.intent === "remove-course") {
    removeCourseBookmark(currentUserId, parsed.data.courseId);
  } else {
    removeLessonBookmark(currentUserId, parsed.data.lessonId);
  }

  return { success: true };
}

export default function Bookmarks({ loaderData }: Route.ComponentProps) {
  const { courses, lessons } = loaderData;
  const isEmpty = courses.length === 0 && lessons.length === 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Bookmarks</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Bookmarks</h1>
        <p className="mt-1 text-muted-foreground">
          Courses and lessons you've saved for later
        </p>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bookmark className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No bookmarks yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Save a course or lesson with the “Save” button to find it here.
          </p>
          <Link to="/courses" className="mt-4">
            <Button>Browse Courses</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {courses.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Saved Courses</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((course) => (
                  <Card
                    key={course.bookmarkId}
                    className="flex flex-col overflow-hidden pt-0"
                  >
                    <Link
                      to={`/courses/${course.courseSlug}`}
                      className="aspect-video overflow-hidden"
                    >
                      <CourseImage
                        src={course.coverImageUrl}
                        alt={course.courseTitle}
                        className="h-full w-full object-cover transition-transform hover:scale-105"
                      />
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
                    <CardContent className="mt-auto flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {course.instructorName}
                      </span>
                      <RemoveButton
                        intent="remove-course"
                        idName="courseId"
                        idValue={course.courseId}
                        label="Remove bookmarked course"
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {lessons.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Saved Lessons</h2>
              <div className="space-y-3">
                {lessons.map((lesson) => (
                  <Card key={lesson.bookmarkId}>
                    <CardContent className="flex items-center gap-4 py-4">
                      <PlayCircle className="size-5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/courses/${lesson.courseSlug}/lessons/${lesson.lessonId}`}
                          className="block truncate font-medium hover:text-primary"
                        >
                          {lesson.lessonTitle}
                        </Link>
                        <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <BookOpen className="size-3 shrink-0" />
                          {lesson.courseTitle} · {lesson.moduleTitle}
                        </div>
                      </div>
                      <RemoveButton
                        intent="remove-lesson"
                        idName="lessonId"
                        idValue={lesson.lessonId}
                        label="Remove bookmarked lesson"
                      />
                    </CardContent>
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

function RemoveButton({
  intent,
  idName,
  idValue,
  label,
}: {
  intent: "remove-course" | "remove-lesson";
  idName: "courseId" | "lessonId";
  idValue: number;
  label: string;
}) {
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name={idName} value={idValue} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        title={label}
        aria-label={label}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="size-4" />
      </Button>
    </fetcher.Form>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your bookmarks.";

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
        <Link to="/courses">
          <Button>Browse Courses</Button>
        </Link>
      </div>
    </div>
  );
}
