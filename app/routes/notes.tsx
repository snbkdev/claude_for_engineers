import { Link, useFetcher, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/notes";
import { getCurrentUserId } from "~/lib/session";
import {
  getNotesForUser,
  getNoteById,
  deleteNote,
} from "~/services/noteService";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, NotebookPen, StickyNote, Trash2 } from "lucide-react";

export function meta() {
  return [
    { title: "My Notes — Cadence" },
    { name: "description", content: "All your lesson notes in one place" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your notes.", {
      status: 401,
    });
  }

  const notes = getNotesForUser(currentUserId);

  // Group by course, preserving the newest-edited-first order from the query.
  const courseOrder: number[] = [];
  const byCourse = new Map<
    number,
    { courseTitle: string; courseSlug: string; notes: typeof notes }
  >();
  for (const note of notes) {
    let group = byCourse.get(note.courseId);
    if (!group) {
      group = {
        courseTitle: note.courseTitle,
        courseSlug: note.courseSlug,
        notes: [],
      };
      byCourse.set(note.courseId, group);
      courseOrder.push(note.courseId);
    }
    group.notes.push(note);
  }

  const courses = courseOrder.map((id) => ({
    courseId: id,
    ...byCourse.get(id)!,
  }));

  return { courses, totalNotes: notes.length };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete-note") {
    const noteId = Number(formData.get("noteId"));
    if (isNaN(noteId)) {
      throw data("Invalid note", { status: 400 });
    }

    const note = getNoteById(noteId);
    if (!note) {
      throw data("Note not found", { status: 404 });
    }
    if (note.userId !== currentUserId) {
      throw data("You cannot delete this note", { status: 403 });
    }

    deleteNote(noteId);
    return { success: true };
  }

  throw data("Invalid action", { status: 400 });
}

function formatNoteDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-5 w-64" />
      <Skeleton className="mt-8 h-40 w-full rounded-xl" />
    </div>
  );
}

export default function NotesPage({ loaderData }: Route.ComponentProps) {
  const { courses, totalNotes } = loaderData;
  const fetcher = useFetcher();

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/dashboard" className="hover:text-foreground">
          Dashboard
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">My Notes</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Notes</h1>
        <p className="mt-1 text-muted-foreground">
          {totalNotes === 0
            ? "Notes you take during lessons show up here."
            : `${totalNotes} note${totalNotes === 1 ? "" : "s"} across your courses.`}
        </p>
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <NotebookPen className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">
            You haven't taken any notes yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a lesson and use the notes panel to jot down key takeaways.
          </p>
          <Link
            to="/courses"
            className="mt-4 text-sm font-medium text-primary hover:underline"
          >
            Browse courses
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {courses.map((course) => (
            <Card key={course.courseId}>
              <CardHeader>
                <Link
                  to={`/courses/${course.courseSlug}`}
                  className="text-lg font-semibold leading-tight hover:text-primary"
                >
                  {course.courseTitle}
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {course.notes.map((note) => (
                  <div key={note.id} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Link
                        to={`/courses/${course.courseSlug}/lessons/${note.lessonId}`}
                        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <StickyNote className="size-3.5" />
                        {note.lessonTitle}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatNoteDate(note.updatedAt)}
                        </span>
                        <fetcher.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="delete-note"
                          />
                          <input type="hidden" name="noteId" value={note.id} />
                          <button
                            type="submit"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                            title="Delete note"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </fetcher.Form>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">
                      {note.content}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your notes.";

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
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
