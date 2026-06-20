import { useState, useEffect } from "react";
import { Link, useFetcher, useBlocker } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/instructor.$courseId.lessons.$lessonId";
import { getCourseById } from "~/services/courseService";
import { getLessonById, updateLesson } from "~/services/lessonService";
import { getModuleById } from "~/services/moduleService";
import { getQuizByLessonId } from "~/services/quizService";
import {
  getResourcesForLesson,
  getResourceById,
  createResource,
  deleteResource,
} from "~/services/resourceService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { MonacoMarkdownEditor } from "~/components/monaco-markdown-editor";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  ExternalLink,
  Github,
  Save,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import * as v from "valibot";
import { parseFormData, parseParams } from "~/lib/validation";

const instructorLessonParamsSchema = v.object({
  courseId: v.pipe(v.string(), v.transform(Number), v.integer()),
  lessonId: v.pipe(v.string(), v.transform(Number), v.integer()),
});

const updateLessonSchema = v.object({
  intent: v.literal("update-lesson"),
  content: v.optional(v.string()),
  videoUrl: v.optional(v.pipe(v.string(), v.trim())),
  durationMinutes: v.optional(v.string()),
  githubRepoUrl: v.optional(v.pipe(v.string(), v.trim())),
});

const addResourceSchema = v.object({
  intent: v.literal("add-resource"),
  title: v.pipe(v.string(), v.trim(), v.minLength(1, "Title is required.")),
  url: v.pipe(v.string(), v.trim(), v.minLength(1, "URL is required.")),
  type: v.optional(v.pipe(v.string(), v.trim())),
});

const deleteResourceSchema = v.object({
  intent: v.literal("delete-resource"),
  resourceId: v.pipe(v.string(), v.transform(Number), v.integer()),
});

const lessonActionSchema = v.variant("intent", [
  updateLessonSchema,
  addResourceSchema,
  deleteResourceSchema,
]);

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.lesson?.title ?? "Edit Lesson";
  return [
    { title: `Edit: ${title} — Cadence` },
    { name: "description", content: `Edit lesson: ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to manage lessons.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can access this page.", {
      status: 403,
    });
  }

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);

  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    throw data("You can only edit your own courses.", { status: 403 });
  }

  const lessonId = parseInt(params.lessonId, 10);
  if (isNaN(lessonId)) {
    throw data("Invalid lesson ID.", { status: 400 });
  }

  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found.", { status: 404 });
  }

  const mod = getModuleById(lesson.moduleId);
  if (!mod || mod.courseId !== courseId) {
    throw data("Lesson not found in this course.", { status: 404 });
  }

  const quiz = getQuizByLessonId(lessonId);
  const resources = getResourcesForLesson(lessonId);

  return { course, lesson, module: mod, quiz, resources };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const user = getUserById(currentUserId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can edit lessons.", {
      status: 403,
    });
  }

  const { courseId, lessonId } = parseParams(
    params,
    instructorLessonParamsSchema
  );

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    throw data("You can only edit your own courses.", { status: 403 });
  }

  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found.", { status: 404 });
  }

  const mod = getModuleById(lesson.moduleId);
  if (!mod || mod.courseId !== courseId) {
    throw data("Lesson not found in this course.", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, lessonActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  if (parsed.data.intent === "add-resource") {
    const { title, url, type } = parsed.data;
    createResource({ lessonId, title, url, type: type ?? null });
    return { success: true };
  }

  if (parsed.data.intent === "delete-resource") {
    const resource = getResourceById(parsed.data.resourceId);
    if (!resource || resource.lessonId !== lessonId) {
      throw data("Resource not found.", { status: 404 });
    }
    deleteResource(resource.id);
    return { success: true };
  }

  if (parsed.data.intent === "update-lesson") {
    const {
      content,
      videoUrl,
      durationMinutes: durationStr,
      githubRepoUrl,
    } = parsed.data;
    const durationMinutes = durationStr ? parseInt(durationStr, 10) : null;

    if (
      durationMinutes !== null &&
      (isNaN(durationMinutes) || durationMinutes < 0)
    ) {
      return data(
        { error: "Duration must be a positive number." },
        { status: 400 }
      );
    }

    updateLesson({
      id: lessonId,
      title: null,
      content: content ?? null,
      videoUrl: videoUrl || null,
      durationMinutes,
      githubRepoUrl: githubRepoUrl || null,
    });
    return { success: true };
  }

  throw data("Invalid action.", { status: 400 });
}

export default function InstructorLessonEditor({
  loaderData,
}: Route.ComponentProps) {
  const { course, lesson, module: mod, quiz, resources } = loaderData;
  const fetcher = useFetcher();
  const resourceFetcher = useFetcher();

  const [content, setContent] = useState(lesson.content ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl ?? "");
  const [durationMinutes, setDurationMinutes] = useState(
    lesson.durationMinutes?.toString() ?? ""
  );
  const [githubRepoUrl, setGithubRepoUrl] = useState(
    lesson.githubRepoUrl ?? ""
  );

  const [resTitle, setResTitle] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resType, setResType] = useState("");

  const hasChanges =
    content !== (lesson.content ?? "") ||
    videoUrl !== (lesson.videoUrl ?? "") ||
    durationMinutes !== (lesson.durationMinutes?.toString() ?? "") ||
    githubRepoUrl !== (lesson.githubRepoUrl ?? "");

  const blocker = useBlocker(hasChanges);

  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Lesson saved.");
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (resourceFetcher.state === "idle" && resourceFetcher.data?.success) {
      setResTitle("");
      setResUrl("");
      setResType("");
    }
    if (resourceFetcher.state === "idle" && resourceFetcher.data?.error) {
      toast.error(resourceFetcher.data.error);
    }
  }, [resourceFetcher.state, resourceFetcher.data]);

  function handleAddResource() {
    resourceFetcher.submit(
      { intent: "add-resource", title: resTitle, url: resUrl, type: resType },
      { method: "post" }
    );
  }

  function handleSave() {
    fetcher.submit(
      {
        intent: "update-lesson",
        content,
        videoUrl,
        durationMinutes,
        githubRepoUrl,
      },
      { method: "post" }
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Unsaved changes blocker dialog */}
      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-md">
            <CardHeader>
              <h2 className="text-lg font-semibold">Unsaved Changes</h2>
              <p className="text-sm text-muted-foreground">
                You have unsaved changes that will be lost if you leave this
                page.
              </p>
            </CardHeader>
            <CardContent className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => blocker.reset()}>
                Stay on Page
              </Button>
              <Button variant="destructive" onClick={() => blocker.proceed()}>
                Leave Page
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${course.id}`} className="hover:text-foreground">
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{lesson.title}</span>
      </nav>

      <Link
        to={`/instructor/${course.id}`}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Course Editor
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{lesson.title}</h1>
          <Link to={`/courses/${course.slug}/lessons/${lesson.id}`}>
            <Button variant="outline" size="sm">
              <ExternalLink className="mr-1.5 size-4" />
              View Lesson
            </Button>
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Module: {mod.title}
        </p>
      </div>

      <div className="space-y-6">
        {/* Content */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Lesson Content</h2>
            <p className="text-sm text-muted-foreground">
              Write lesson content in Markdown. Press Ctrl+S to format and save.
            </p>
          </CardHeader>
          <CardContent>
            <MonacoMarkdownEditor
              value={content}
              onChange={setContent}
              onSave={handleSave}
            />
          </CardContent>
        </Card>

        {/* Video URL */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Video</h2>
            <p className="text-sm text-muted-foreground">
              Paste a YouTube video URL to embed in this lesson.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="videoUrl">YouTube URL</Label>
              <Input
                id="videoUrl"
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Duration */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Duration</h2>
            <p className="text-sm text-muted-foreground">
              Set the estimated time to complete this lesson.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min="0"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="e.g. 15"
                className="max-w-32"
              />
            </div>
          </CardContent>
        </Card>

        {/* GitHub Repo */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">GitHub Repository</h2>
            <p className="text-sm text-muted-foreground">
              Link to a GitHub repository for this lesson's code.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="githubRepoUrl">Repository URL</Label>
              <Input
                id="githubRepoUrl"
                type="url"
                value={githubRepoUrl}
                onChange={(e) => setGithubRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
              />
            </div>
          </CardContent>
        </Card>

        {/* Resources */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Resources</h2>
            <p className="text-sm text-muted-foreground">
              Attach slides, source code, checklists or any link for this
              lesson.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {resources.length > 0 ? (
              <ul className="space-y-2">
                {resources.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 truncate font-medium hover:text-primary"
                      >
                        {r.title}
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.type ? `${r.type} · ` : ""}
                        {r.url}
                      </p>
                    </div>
                    <resourceFetcher.Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value="delete-resource"
                      />
                      <input type="hidden" name="resourceId" value={r.id} />
                      <button
                        type="submit"
                        title="Delete resource"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </resourceFetcher.Form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No resources yet.</p>
            )}

            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="resTitle">Title</Label>
                <Input
                  id="resTitle"
                  value={resTitle}
                  onChange={(e) => setResTitle(e.target.value)}
                  placeholder="Slides"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="resUrl">URL</Label>
                <Input
                  id="resUrl"
                  type="url"
                  value={resUrl}
                  onChange={(e) => setResUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="resType">Type</Label>
                <Input
                  id="resType"
                  value={resType}
                  onChange={(e) => setResType(e.target.value)}
                  placeholder="pdf"
                />
              </div>
              <Button
                type="button"
                onClick={handleAddResource}
                disabled={
                  !resTitle.trim() ||
                  !resUrl.trim() ||
                  resourceFetcher.state !== "idle"
                }
              >
                <Plus className="mr-1.5 size-4" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quiz */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Quiz</h2>
            <p className="text-sm text-muted-foreground">
              {quiz
                ? `This lesson has a quiz: "${quiz.title}"`
                : "No quiz attached to this lesson yet."}
            </p>
          </CardHeader>
          <CardContent>
            <Link to={`/instructor/${course.id}/lessons/${lesson.id}/quiz`}>
              <Button variant="outline">
                <ClipboardList className="mr-1.5 size-4" />
                {quiz ? "Edit Quiz" : "Create Quiz"}
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || fetcher.state !== "idle"}
          >
            <Save className="mr-1.5 size-4" />
            {fetcher.state !== "idle" ? "Saving..." : "Save Changes"}
          </Button>
          {hasChanges && (
            <span className="text-sm text-muted-foreground">
              You have unsaved changes.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading the lesson editor.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Lesson not found";
      message =
        "The lesson you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
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
          : "You don't have permission to edit this lesson.";
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
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
