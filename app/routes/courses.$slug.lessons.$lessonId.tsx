import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/courses.$slug.lessons.$lessonId";
import {
  getCourseBySlug,
  getCourseWithDetails,
} from "~/services/courseService";
import { getLessonById } from "~/services/lessonService";
import { getModuleById } from "~/services/moduleService";
import { getCurrentUserId } from "~/lib/session";
import { isUserEnrolled } from "~/services/enrollmentService";
import {
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
} from "~/services/progressService";
import {
  getLastWatchPosition,
  calculateWatchProgress,
  getUserWatchHistory,
} from "~/services/videoTrackingService";
import {
  getQuizByLessonId,
  getQuizWithQuestions,
  getBestAttempt,
} from "~/services/quizService";
import {
  submitQuizAttempt,
  countQuizAttempts,
  MAX_QUIZ_ATTEMPTS,
} from "~/services/quizScoringService";
import { maybeCompleteCourse } from "~/services/certificateService";
import { evaluateAchievements } from "~/services/achievementService";
import { LessonProgressStatus, UserRole } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Github,
  HelpCircle,
  MapPin,
  PlayCircle,
  ShieldAlert,
  XCircle,
  Trophy,
  RotateCcw,
  StickyNote,
  Pencil,
  Plus,
  Paperclip,
  ExternalLink,
} from "lucide-react";
import { cn, formatDuration } from "~/lib/utils";
import { renderMarkdown } from "~/lib/markdown.server";
import { YouTubePlayer } from "~/components/youtube-player";
import { data, isRouteErrorResponse } from "react-router";
import * as v from "valibot";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess, COUNTRIES } from "~/lib/ppp";
import { findPurchase } from "~/services/purchaseService";
import {
  getCommentsForLesson,
  buildCommentTree,
  createComment,
  deleteComment,
  getCommentById,
  getCommentScores,
  getUserVotes,
  voteOnComment,
} from "~/services/commentService";
import { UserAvatar } from "~/components/user-avatar";
import { Textarea } from "~/components/ui/textarea";
import { MessageSquare, Reply, Trash2 } from "lucide-react";
import { parseFormData, parseParams } from "~/lib/validation";
import {
  isLessonBookmarked,
  toggleBookmark,
  getBookmarkedLessonIds,
} from "~/services/bookmarkService";
import {
  getNotesForLesson,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
} from "~/services/noteService";
import { getResourcesForLesson } from "~/services/resourceService";

const lessonParamsSchema = v.object({
  slug: v.pipe(v.string(), v.minLength(1)),
  lessonId: v.pipe(v.string(), v.transform(Number), v.integer()),
});

const markCompleteSchema = v.object({
  intent: v.literal("mark-complete"),
});

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.lesson?.title ?? "Lesson";
  const courseTitle = loaderData?.course?.title ?? "Course";
  return [{ title: `${title} — ${courseTitle} — Cadence` }];
}

type FlatLesson = {
  id: number;
  title: string;
  moduleId: number;
  moduleTitle: string;
};

function flattenCourseLessons(course: {
  modules: Array<{
    id: number;
    title: string;
    lessons: Array<{ id: number; title: string; moduleId: number }>;
  }>;
}): FlatLesson[] {
  const flat: FlatLesson[] = [];
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      flat.push({
        id: lesson.id,
        title: lesson.title,
        moduleId: mod.id,
        moduleTitle: mod.title,
      });
    }
  }
  return flat;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const lessonId = Number(params.lessonId);

  if (isNaN(lessonId)) {
    throw data("Invalid lesson ID", { status: 400 });
  }

  const course = getCourseBySlug(slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const courseWithDetails = getCourseWithDetails(course.id);
  if (!courseWithDetails) {
    throw data("Course not found", { status: 404 });
  }

  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }

  const mod = getModuleById(lesson.moduleId);
  if (!mod) {
    throw data("Module not found", { status: 404 });
  }

  // Verify lesson belongs to this course
  if (mod.courseId !== course.id) {
    throw data("Lesson not found in this course", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  let enrolled = false;
  let lessonStatus: string | null = null;
  let lastWatchPosition = 0;
  let watchProgress = 0;
  let lessonProgressMap: Record<number, string> = {};
  let isBookmarked = false;
  let bookmarkedLessonIds: number[] = [];
  let videoProgressMap: Record<number, number> = {};

  if (currentUserId) {
    enrolled = isUserEnrolled({ userId: currentUserId, courseId: course.id });

    if (enrolled) {
      isBookmarked = isLessonBookmarked({ userId: currentUserId, lessonId });
      bookmarkedLessonIds = getBookmarkedLessonIds({
        userId: currentUserId,
        courseId: course.id,
      });

      // Mark lesson as in-progress when viewed
      markLessonInProgress({ userId: currentUserId, lessonId });
      const progress = getLessonProgress({ userId: currentUserId, lessonId });
      lessonStatus = progress?.status ?? null;

      // Get progress for all lessons in course (for curriculum sidebar)
      const progressRecords = getLessonProgressForCourse({
        userId: currentUserId,
        courseId: course.id,
      });
      for (const record of progressRecords) {
        lessonProgressMap[record.lessonId] = record.status;
      }

      // Per-lesson video watch progress (%) for the curriculum sidebar.
      const lastPosByLesson = new Map(
        getUserWatchHistory(currentUserId).map((h) => [
          h.lessonId,
          h.lastPosition,
        ])
      );
      for (const m of courseWithDetails.modules) {
        for (const l of m.lessons) {
          const durationSeconds = (l.durationMinutes ?? 0) * 60;
          const pos = lastPosByLesson.get(l.id) ?? 0;
          if (durationSeconds > 0 && pos > 0) {
            videoProgressMap[l.id] = Math.min(
              Math.round((pos / durationSeconds) * 100),
              100
            );
          }
        }
      }

      // Get video watch state for resume and progress display
      if (lesson.videoUrl) {
        // Resume from the saved position, but restart a completed lesson from
        // the beginning (its last event is "ended" near the very end).
        lastWatchPosition =
          lessonStatus === LessonProgressStatus.Completed
            ? 0
            : getLastWatchPosition({ userId: currentUserId, lessonId });
        const videoDurationSeconds = (lesson.durationMinutes ?? 0) * 60;
        if (videoDurationSeconds > 0) {
          watchProgress = calculateWatchProgress({
            userId: currentUserId,
            lessonId,
            videoDurationSeconds,
          });
        }
      }
    }
  }

  // PPP Access Guard
  let pppBlocked = false;
  let pppBlockedCountry: string | null = null;
  let pppPurchaseCountry: string | null = null;

  if (enrolled && currentUserId) {
    const purchase = findPurchase({
      userId: currentUserId,
      courseId: course.id,
    });
    const currentCountry = await resolveCountry(request);
    const pppResult = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      currentCountry
    );
    pppBlocked = pppResult.blocked;
    pppBlockedCountry = pppResult.blockedCountry;
    pppPurchaseCountry = pppResult.purchaseCountry;
  }

  // Comments: students who own the course (or the instructor) take part in the
  // lesson discussion. Students post comments; the instructor replies.
  const isInstructor =
    currentUserId != null && course.instructorId === currentUserId;
  const hasPurchased =
    currentUserId != null &&
    !!findPurchase({ userId: currentUserId, courseId: course.id });
  const canComment = isInstructor || hasPurchased;

  // Enrich each comment with its vote score and the current user's own vote,
  // then build the thread tree and flag answered questions (a question with at
  // least one instructor reply).
  let comments: CommentNode[] = [];
  if (canComment) {
    const rawComments = getCommentsForLesson(lessonId);
    const commentIds = rawComments.map((c) => c.id);
    const scores = getCommentScores(commentIds);
    const myVotes = currentUserId
      ? getUserVotes({ userId: currentUserId, commentIds })
      : new Map<number, number>();
    const enriched = rawComments.map((c) => ({
      ...c,
      score: scores.get(c.id) ?? 0,
      myVote: myVotes.get(c.id) ?? 0,
    }));
    comments = buildCommentTree(enriched).map((node) => ({
      ...node,
      answeredByInstructor: node.replies.some(
        (r) => r.userRole === UserRole.Instructor
      ),
    }));
  }

  // Private notes — visible to whoever can access the lesson (owner or teacher).
  const notes =
    currentUserId && (enrolled || isInstructor)
      ? getNotesForLesson({ userId: currentUserId, lessonId })
      : [];

  // Lesson attachments/resources (not sensitive — shown to any viewer).
  const resources = getResourcesForLesson(lessonId);

  // Achievements: award any badge newly unlocked by the latest progress (e.g.
  // completing this lesson or passing its quiz). Idempotent; `newAchievements`
  // is non-empty only on the transition, driving an unlock toast.
  const newAchievements =
    enrolled && currentUserId
      ? evaluateAchievements({ userId: currentUserId })
      : [];

  // Render lesson content from Markdown to HTML server-side
  const contentHtml = lesson.content
    ? await renderMarkdown(lesson.content)
    : null;

  // Build prev/next navigation
  const allLessons = flattenCourseLessons(courseWithDetails);
  const currentIndex = allLessons.findIndex((l) => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson =
    currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  // Check for quiz attached to this lesson
  const quizRecord = getQuizByLessonId(lessonId);
  let quiz: {
    id: number;
    title: string;
    passingScore: number;
    questions: Array<{
      id: number;
      questionText: string;
      questionType: string;
      position: number;
      options: Array<{ id: number; optionText: string }>;
    }>;
  } | null = null;
  let bestAttempt: { score: number; passed: boolean } | null = null;
  let quizAttemptsUsed = 0;

  if (quizRecord) {
    const quizData = getQuizWithQuestions(quizRecord.id);
    if (quizData) {
      // Strip isCorrect from options so answers aren't leaked to the client
      quiz = {
        id: quizData.id,
        title: quizData.title,
        passingScore: quizData.passingScore,
        questions: quizData.questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType,
          position: q.position,
          options: q.options.map((o) => ({
            id: o.id,
            optionText: o.optionText,
          })),
        })),
      };
    }

    if (currentUserId) {
      const best = getBestAttempt({
        userId: currentUserId,
        quizId: quizRecord.id,
      });
      if (best) {
        bestAttempt = { score: best.score, passed: best.passed };
      }
      quizAttemptsUsed = countQuizAttempts({
        userId: currentUserId,
        quizId: quizRecord.id,
      });
    }
  }

  return {
    course: {
      id: courseWithDetails.id,
      title: courseWithDetails.title,
      slug: courseWithDetails.slug,
    },
    curriculum: courseWithDetails.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
      })),
    })),
    module: {
      id: mod.id,
      title: mod.title,
    },
    lesson,
    contentHtml,
    lessonStatus,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    quiz,
    bestAttempt,
    quizAttemptsUsed,
    maxQuizAttempts: MAX_QUIZ_ATTEMPTS,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
    videoProgressMap,
    pppBlocked,
    pppBlockedCountry,
    pppPurchaseCountry,
    comments,
    canComment,
    isInstructor,
    isBookmarked,
    bookmarkedLessonIds,
    notes,
    resources,
    newAchievements,
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { slug, lessonId } = parseParams(params, lessonParamsSchema);

  const course = getCourseBySlug(slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-complete") {
    markLessonComplete({ userId: currentUserId, lessonId });
    // Completing this lesson may finish the course → mark complete + issue cert.
    maybeCompleteCourse({ userId: currentUserId, courseId: course.id });
    return { success: true };
  }

  if (intent === "submit-quiz") {
    const quizId = Number(formData.get("quizId"));
    if (isNaN(quizId)) {
      throw data("Invalid quiz ID", { status: 400 });
    }

    // Collect answers: form fields named "question-{questionId}" with value =
    // optionId. Multi-select questions submit several values under the same name,
    // so each question maps to an array of selected option ids.
    const selectedAnswers: Record<number, number[]> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("question-")) {
        const questionId = Number(key.replace("question-", ""));
        const optionId = Number(value);
        if (!isNaN(questionId) && !isNaN(optionId)) {
          (selectedAnswers[questionId] ??= []).push(optionId);
        }
      }
    }

    const outcome = submitQuizAttempt({
      userId: currentUserId,
      quizId,
      selectedAnswers,
    });
    if (!outcome.ok) {
      // User-facing conditions (e.g. no attempts remaining) are returned so the
      // quiz UI can show them inline rather than replacing the page.
      return { quizError: outcome.error };
    }

    // Passing a quiz auto-completes the lesson, which may finish the course.
    if (outcome.result.lessonCompleted) {
      maybeCompleteCourse({ userId: currentUserId, courseId: course.id });
    }

    return { quizResult: outcome.result };
  }

  if (intent === "add-comment") {
    const isInstructor = course.instructorId === currentUserId;
    const hasPurchased = !!findPurchase({
      userId: currentUserId,
      courseId: course.id,
    });
    if (!isInstructor && !hasPurchased) {
      throw data("You must own this course to comment", { status: 403 });
    }

    const content = String(formData.get("content") ?? "");
    const parentIdRaw = formData.get("parentId");
    let parentId: number | null = null;
    if (parentIdRaw != null && parentIdRaw !== "") {
      parentId = Number(parentIdRaw);
      if (isNaN(parentId)) {
        throw data("Invalid parent comment", { status: 400 });
      }
    }

    // Replies are the instructor's tool for answering students.
    if (parentId !== null && !isInstructor) {
      throw data("Only the instructor can reply to comments", { status: 403 });
    }

    if (!content.trim()) {
      return { commentError: "Comment cannot be empty" };
    }

    const isQuestion = formData.get("isQuestion") === "on";
    createComment({
      userId: currentUserId,
      lessonId,
      content,
      parentId,
      isQuestion,
    });
    return { commentSuccess: true };
  }

  if (intent === "vote-comment") {
    const isInstructor = course.instructorId === currentUserId;
    const hasPurchased = !!findPurchase({
      userId: currentUserId,
      courseId: course.id,
    });
    if (!isInstructor && !hasPurchased) {
      throw data("You must own this course to vote", { status: 403 });
    }

    const commentId = Number(formData.get("commentId"));
    const direction = Number(formData.get("value"));
    if (isNaN(commentId) || (direction !== 1 && direction !== -1)) {
      throw data("Invalid vote", { status: 400 });
    }

    const comment = getCommentById(commentId);
    if (!comment || comment.lessonId !== lessonId) {
      throw data("Comment not found", { status: 404 });
    }
    // You can't vote on your own comment.
    if (comment.userId === currentUserId) {
      return { commentError: "You can't vote on your own comment" };
    }

    voteOnComment({ commentId, userId: currentUserId, value: direction });
    return { commentSuccess: true };
  }

  if (intent === "delete-comment") {
    const commentId = Number(formData.get("commentId"));
    if (isNaN(commentId)) {
      throw data("Invalid comment", { status: 400 });
    }

    const comment = getCommentById(commentId);
    if (!comment || comment.lessonId !== lessonId) {
      throw data("Comment not found", { status: 404 });
    }

    // Only the author may remove their own comment — instructors cannot
    // delete or edit students' comments.
    if (comment.userId !== currentUserId) {
      throw data("You cannot delete this comment", { status: 403 });
    }

    deleteComment(commentId);
    return { commentSuccess: true };
  }

  if (intent === "toggle-bookmark") {
    // You can only reach a lesson if you own the course (or teach it).
    const isInstructor = course.instructorId === currentUserId;
    const enrolled = isUserEnrolled({
      userId: currentUserId,
      courseId: course.id,
    });
    if (!isInstructor && !enrolled) {
      throw data("You must be enrolled to bookmark this lesson", {
        status: 403,
      });
    }

    const { bookmarked } = toggleBookmark({
      userId: currentUserId,
      lessonId,
    });
    return { bookmarked };
  }

  if (intent === "add-note") {
    const isInstructor = course.instructorId === currentUserId;
    const enrolled = isUserEnrolled({
      userId: currentUserId,
      courseId: course.id,
    });
    if (!isInstructor && !enrolled) {
      throw data("You must own this course to take notes", { status: 403 });
    }

    const content = String(formData.get("content") ?? "");
    if (!content.trim()) {
      return { noteError: "Note cannot be empty" };
    }

    createNote({ userId: currentUserId, lessonId, content });
    return { noteSuccess: true };
  }

  if (intent === "update-note" || intent === "delete-note") {
    const noteId = Number(formData.get("noteId"));
    if (isNaN(noteId)) {
      throw data("Invalid note", { status: 400 });
    }

    const note = getNoteById(noteId);
    if (!note || note.lessonId !== lessonId) {
      throw data("Note not found", { status: 404 });
    }
    // Notes are private — only the author may edit or remove them.
    if (note.userId !== currentUserId) {
      throw data("You cannot modify this note", { status: 403 });
    }

    if (intent === "delete-note") {
      deleteNote(noteId);
      return { noteSuccess: true };
    }

    const content = String(formData.get("content") ?? "");
    if (!content.trim()) {
      return { noteError: "Note cannot be empty" };
    }
    updateNote({ id: noteId, content });
    return { noteSuccess: true };
  }

  throw data("Invalid action", { status: 400 });
}

const AUTOPLAY_KEY = "cadence-autoplay";

function useAutoplay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(AUTOPLAY_KEY) === "true");
    } catch {
      /* silently fail */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOPLAY_KEY, String(next));
      } catch {
        /* silently fail */
      }
      return next;
    });
  }, []);

  return [enabled, toggle] as const;
}

export default function LessonViewer({ loaderData }: Route.ComponentProps) {
  const {
    course,
    curriculum,
    module: mod,
    lesson,
    contentHtml,
    lessonStatus,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    quiz,
    bestAttempt,
    quizAttemptsUsed,
    maxQuizAttempts,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
    videoProgressMap,
    pppBlocked,
    pppBlockedCountry,
    pppPurchaseCountry,
    comments,
    canComment,
    isInstructor,
    isBookmarked,
    bookmarkedLessonIds,
    notes,
    resources,
    newAchievements,
  } = loaderData;
  const [autoplay, toggleAutoplay] = useAutoplay();
  const fetcher = useFetcher({ key: `mark-complete-${lesson.id}` });
  const quizFetcher = useFetcher({ key: `quiz-${lesson.id}` });
  const navigate = useNavigate();

  const isMarking =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "mark-complete";

  const justCompleted = fetcher.data?.success;

  const isCompleted =
    lessonStatus === LessonProgressStatus.Completed || justCompleted;

  // Navigate to next lesson after marking complete
  useEffect(() => {
    if (justCompleted && nextLesson) {
      navigate(`/courses/${course.slug}/lessons/${nextLesson.id}`);
    }
  }, [justCompleted, nextLesson, course.slug, navigate]);

  // Celebrate any badge unlocked by completing this lesson / passing its quiz.
  useEffect(() => {
    for (const a of newAchievements) {
      toast.success(`Achievement unlocked: ${a.title}`, {
        description: a.description,
      });
    }
  }, [newAchievements]);

  const quizResult = quizFetcher.data?.quizResult ?? null;
  const quizError = quizFetcher.data?.quizError ?? null;
  const isSubmittingQuiz = quizFetcher.state !== "idle";
  const notesFetcher = useFetcher({ key: `notes-${lesson.id}` });
  const revalidator = useRevalidator();

  if (pppBlocked) {
    const purchaseCountryName = pppPurchaseCountry
      ? (COUNTRIES.find((c) => c.code === pppPurchaseCountry)?.name ??
        pppPurchaseCountry)
      : "your original country";
    const currentCountryName = pppBlockedCountry
      ? (COUNTRIES.find((c) => c.code === pppBlockedCountry)?.name ??
        pppBlockedCountry)
      : "a different country";

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto mb-4 size-16 text-amber-500" />
          <h1 className="mb-3 text-2xl font-bold">Access Restricted</h1>
          <p className="mb-4 text-muted-foreground">
            You purchased this course with a Purchasing Power Parity discount
            while in <strong>{purchaseCountryName}</strong>, but you're
            currently accessing from <strong>{currentCountryName}</strong>.
          </p>
          <p className="mb-6 text-sm text-muted-foreground">
            PPP-discounted courses can only be accessed from the country where
            the purchase was made. This helps keep courses affordable for
            students in lower-income regions.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link to={`/courses/${course.slug}`}>
              <Button variant="outline">
                <MapPin className="mr-2 size-4" />
                Back to Course
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      {/* Curriculum Sidebar */}
      <CurriculumSidebar
        course={course}
        curriculum={curriculum}
        currentLessonId={lesson.id}
        lessonProgressMap={lessonProgressMap}
        videoProgressMap={videoProgressMap}
        enrolled={enrolled}
        bookmarkedLessonIds={bookmarkedLessonIds}
      />

      <div className="flex-1 p-6 lg:p-8">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link to="/courses" className="hover:text-foreground">
            Courses
          </Link>
          <span className="mx-2">/</span>
          <Link
            to={`/courses/${course.slug}`}
            className="hover:text-foreground"
          >
            {course.title}
          </Link>
          <span className="mx-2">/</span>
          <Link
            to={`/courses/${course.slug}/${mod.id}`}
            className="hover:text-foreground"
          >
            {mod.title}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{lesson.title}</span>
        </nav>

        <div className="flex flex-col gap-8 xl:flex-row">
          <div className="mx-auto w-full max-w-4xl xl:mx-0 xl:min-w-0 xl:flex-1">
            {/* Lesson Title */}
            <h1 className="mb-2 text-3xl font-bold">{lesson.title}</h1>
            <div className="mb-6 flex items-center gap-3">
              {lesson.durationMinutes && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="size-4" />
                  {formatDuration(lesson.durationMinutes, true, false, false)}
                </div>
              )}
              {lesson.githubRepoUrl && (
                <a
                  href={lesson.githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm">
                    <Github className="mr-1.5 size-4" />
                    Open Code
                  </Button>
                </a>
              )}
              {enrolled && currentUserId && (
                <LessonBookmarkButton isBookmarked={isBookmarked} />
              )}
            </div>

            {/* YouTube Video */}
            {lesson.videoUrl && (
              <YouTubePlayer
                videoUrl={lesson.videoUrl}
                lessonId={lesson.id}
                title={lesson.title}
                startPosition={lastWatchPosition}
                durationMinutes={lesson.durationMinutes}
                watchProgress={watchProgress}
                trackingEnabled={enrolled && !!currentUserId}
                autoplay={autoplay}
                onToggleAutoplay={toggleAutoplay}
                onAutoComplete={() => {
                  toast.success("Lesson completed!");
                  revalidator.revalidate();
                }}
              />
            )}

            {/* Lesson Content */}
            {contentHtml && (
              <div
                className="prose prose-neutral dark:prose-invert mb-8 max-w-none"
                dangerouslySetInnerHTML={{ __html: contentHtml }}
              />
            )}

            {!contentHtml && !lesson.videoUrl && (
              <Card className="mb-8">
                <CardContent className="py-12 text-center text-muted-foreground">
                  No content has been added to this lesson yet.
                </CardContent>
              </Card>
            )}

            {/* Lesson materials */}
            {resources.length > 0 && (
              <Card className="mb-8">
                <CardContent className="p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Paperclip className="size-5 text-primary" />
                    <h2 className="text-xl font-semibold">Lesson materials</h2>
                  </div>
                  <ul className="space-y-2">
                    {resources.map((r) => (
                      <li key={r.id}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
                        >
                          <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {r.title}
                            </span>
                            {r.type && (
                              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                {r.type}
                              </span>
                            )}
                          </div>
                          <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Quiz Section */}
            {quiz && enrolled && currentUserId && (
              <QuizSection
                quiz={quiz}
                bestAttempt={bestAttempt}
                quizResult={quizResult}
                quizError={quizError}
                attemptsUsed={quizAttemptsUsed}
                maxAttempts={maxQuizAttempts}
                quizFetcher={quizFetcher}
                isSubmitting={isSubmittingQuiz}
              />
            )}

            {/* Mark Complete / Up Next */}
            {enrolled && currentUserId && (
              <div className="mb-8">
                {isCompleted ? (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle2 className="size-5" />
                      <span className="font-medium">Lesson completed</span>
                    </div>
                    {nextLesson && (
                      <Link
                        to={`/courses/${course.slug}/lessons/${nextLesson.id}`}
                      >
                        <Button variant="outline" size="sm">
                          Up next: {nextLesson.title}
                          <ChevronRight className="ml-1 size-4" />
                        </Button>
                      </Link>
                    )}
                  </div>
                ) : nextLesson ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="mark-complete" />
                    <Button disabled={isMarking}>
                      {isMarking ? (
                        "Completing..."
                      ) : (
                        <>
                          Up next: {nextLesson.title}
                          <ChevronRight className="ml-1 size-4" />
                        </>
                      )}
                    </Button>
                  </fetcher.Form>
                ) : (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="mark-complete" />
                    <Button disabled={isMarking}>
                      <CheckCircle2 className="mr-2 size-4" />
                      {isMarking ? "Marking..." : "Mark as Complete"}
                    </Button>
                  </fetcher.Form>
                )}
              </div>
            )}

            {/* Lesson Discussion */}
            {canComment && (
              <CommentsSection
                comments={comments}
                isInstructor={isInstructor}
                currentUserId={currentUserId}
              />
            )}

            {/* Prev/Next Navigation */}
            <div className="flex items-center justify-between border-t pt-6">
              {prevLesson ? (
                <Link
                  to={`/courses/${course.slug}/lessons/${prevLesson.id}`}
                  className="flex items-center gap-2 text-sm hover:text-foreground text-muted-foreground"
                >
                  <ChevronLeft className="size-4" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Previous
                    </div>
                    <div className="font-medium text-foreground">
                      {prevLesson.title}
                    </div>
                  </div>
                </Link>
              ) : (
                <div />
              )}

              {nextLesson ? (
                <Link
                  to={`/courses/${course.slug}/lessons/${nextLesson.id}`}
                  className="flex items-center gap-2 text-right text-sm hover:text-foreground text-muted-foreground"
                >
                  <div>
                    <div className="text-xs text-muted-foreground">Next</div>
                    <div className="font-medium text-foreground">
                      {nextLesson.title}
                    </div>
                  </div>
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <Link
                  to={`/courses/${course.slug}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <div>
                    <div className="text-xs text-muted-foreground">Back to</div>
                    <div className="font-medium text-foreground">
                      {course.title}
                    </div>
                  </div>
                  <ChevronRight className="size-4" />
                </Link>
              )}
            </div>
          </div>

          {currentUserId && (enrolled || isInstructor) && (
            <aside className="w-full xl:w-80 xl:shrink-0">
              <div className="xl:sticky xl:top-6">
                <NotesPanel notes={notes} notesFetcher={notesFetcher} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

// Bookmark toggle shown in the lesson metadata row; uses its own fetcher so the
// amber fill flips optimistically while the toggle is in flight.
function LessonBookmarkButton({ isBookmarked }: { isBookmarked: boolean }) {
  const fetcher = useFetcher<{ bookmarked?: boolean }>();
  const pending = fetcher.state !== "idle";
  const bookmarked = pending ? !isBookmarked : isBookmarked;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="toggle-bookmark" />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Bookmark
          className={cn(
            "mr-1.5 size-4",
            bookmarked
              ? "fill-amber-500 text-amber-500"
              : "text-muted-foreground"
          )}
        />
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </Button>
    </fetcher.Form>
  );
}

function CurriculumSidebar({
  course,
  curriculum,
  currentLessonId,
  lessonProgressMap,
  videoProgressMap,
  enrolled,
  bookmarkedLessonIds,
}: {
  course: { id: number; title: string; slug: string };
  curriculum: Array<{
    id: number;
    title: string;
    lessons: Array<{ id: number; title: string }>;
  }>;
  currentLessonId: number;
  lessonProgressMap: Record<number, string>;
  videoProgressMap: Record<number, number>;
  enrolled: boolean;
  bookmarkedLessonIds: number[];
}) {
  const bookmarkedSet = new Set(bookmarkedLessonIds);

  // Find which module the current lesson belongs to
  const currentModuleId = curriculum.find((m) =>
    m.lessons.some((l) => l.id === currentLessonId)
  )?.id;

  const [expandedModules, setExpandedModules] = useState<Set<number>>(() => {
    // Start with current module expanded
    const initial = new Set<number>();
    if (currentModuleId) initial.add(currentModuleId);
    return initial;
  });

  function toggleModule(moduleId: number) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }

  return (
    <aside className="hidden w-72 shrink-0 border-r border-border lg:block">
      <div className="sticky top-0 flex h-screen flex-col overflow-y-auto">
        <div className="border-b border-border p-4">
          <Link
            to={`/courses/${course.slug}`}
            className="text-sm font-semibold hover:text-primary"
          >
            {course.title}
          </Link>
        </div>

        <nav className="flex-1 p-2">
          {curriculum.map((mod) => {
            const isExpanded = expandedModules.has(mod.id);
            const moduleHasBookmark = mod.lessons.some((l) =>
              bookmarkedSet.has(l.id)
            );

            return (
              <div key={mod.id} className="mb-1">
                <button
                  onClick={() => toggleModule(mod.id)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      !isExpanded && "-rotate-90"
                    )}
                  />
                  <span className="flex-1 text-left">{mod.title}</span>
                  {moduleHasBookmark && (
                    <Bookmark className="size-3.5 shrink-0 fill-amber-500 text-amber-500" />
                  )}
                </button>

                {isExpanded && (
                  <ul className="ml-4 space-y-0.5 py-1">
                    {mod.lessons.map((l) => {
                      const isCurrent = l.id === currentLessonId;
                      const status = lessonProgressMap[l.id];
                      const isCompleted =
                        status === LessonProgressStatus.Completed;
                      const isInProgress =
                        status === LessonProgressStatus.InProgress;
                      // Show video watch progress only while a lesson is still
                      // unfinished (completed lessons get the green check).
                      const videoPct = videoProgressMap[l.id] ?? 0;
                      const showVideoBar =
                        enrolled && !isCompleted && videoPct > 0;

                      return (
                        <li key={l.id}>
                          <Link
                            to={`/courses/${course.slug}/lessons/${l.id}`}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                              isCurrent
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {enrolled ? (
                              isCompleted ? (
                                <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />
                              ) : isInProgress ? (
                                <PlayCircle className="size-3.5 shrink-0 text-blue-500" />
                              ) : (
                                <Circle className="size-3.5 shrink-0" />
                              )
                            ) : (
                              <Circle className="size-3.5 shrink-0" />
                            )}
                            <span className="flex-1 truncate">{l.title}</span>
                            {bookmarkedSet.has(l.id) && (
                              <Bookmark className="size-3.5 shrink-0 fill-amber-500 text-amber-500" />
                            )}
                          </Link>
                          {showVideoBar && (
                            <div
                              className="mx-3 mb-1 h-1 overflow-hidden rounded-full bg-muted"
                              title={`Watched ${videoPct}%`}
                            >
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${videoPct}%` }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

function QuizSection({
  quiz,
  bestAttempt,
  quizResult,
  quizError,
  attemptsUsed,
  maxAttempts,
  quizFetcher,
  isSubmitting,
}: {
  quiz: {
    id: number;
    title: string;
    passingScore: number;
    questions: Array<{
      id: number;
      questionText: string;
      questionType: string;
      position: number;
      options: Array<{ id: number; optionText: string }>;
    }>;
  };
  bestAttempt: { score: number; passed: boolean } | null;
  quizResult: {
    attemptId: number;
    score: number;
    passed: boolean;
    grade: string;
    totalCorrect: number;
    totalQuestions: number;
    questionResults: Array<{
      questionId: number;
      correct: boolean;
      score: number;
      selectedOptionIds: number[];
      correctOptionIds: number[];
      selectedOptionId: number | null;
      correctOptionId: number | null;
    }>;
    lessonCompleted: boolean;
  } | null;
  quizError: string | null;
  attemptsUsed: number;
  maxAttempts: number;
  quizFetcher: ReturnType<typeof useFetcher>;
  isSubmitting: boolean;
}) {
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
  // Each question maps to the option ids the student has selected. Single-select
  // questions hold a 1-element array; multi-select questions hold several.
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, number[]>
  >({});
  const [showQuiz, setShowQuiz] = useState(!bestAttempt?.passed);
  const [retaking, setRetaking] = useState(false);

  useEffect(() => {
    if (quizResult && !retaking) {
      if (quizResult.passed) {
        toast.success(
          `Quiz passed! Score: ${Math.round(quizResult.score * 100)}%`
        );
      } else {
        toast.error(
          `Quiz not passed. Score: ${Math.round(quizResult.score * 100)}%`
        );
      }
    }
  }, [quizResult, retaking]);

  useEffect(() => {
    if (quizError) {
      toast.error(quizError);
    }
  }, [quizError]);

  const allAnswered = quiz.questions.every(
    (q) => (selectedAnswers[q.id]?.length ?? 0) > 0
  );
  const showResult = quizResult && !retaking;

  if (showResult) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <HelpCircle className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">{quiz.title}</h2>
          </div>

          {/* Results summary */}
          <div
            className={`mb-6 rounded-lg p-4 ${quizResult.passed ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}
          >
            <div className="flex items-center gap-3">
              {quizResult.passed ? (
                <Trophy className="size-8 text-green-600" />
              ) : (
                <XCircle className="size-8 text-red-600" />
              )}
              <div>
                <p
                  className={`text-lg font-semibold ${quizResult.passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                >
                  {quizResult.passed ? "You passed!" : "Not quite — try again!"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Score: {quizResult.totalCorrect}/{quizResult.totalQuestions} (
                  {Math.round(quizResult.score * 100)}%) — Grade:{" "}
                  {quizResult.grade}
                </p>
              </div>
            </div>
          </div>

          {/* Per-question results */}
          <div className="space-y-4">
            {quiz.questions.map((question, qIndex) => {
              const result = quizResult.questionResults.find(
                (r) => r.questionId === question.id
              );
              return (
                <div key={question.id} className="rounded-lg border p-4">
                  <div className="mb-2 flex items-start gap-2">
                    {result?.correct ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
                    )}
                    <p className="font-medium">
                      {qIndex + 1}. {question.questionText}
                      {question.questionType === "multi_select" &&
                        result &&
                        !result.correct &&
                        result.score > 0 && (
                          <span className="ml-2 text-sm font-normal text-amber-600 dark:text-amber-400">
                            (partial credit: {Math.round(result.score * 100)}%)
                          </span>
                        )}
                    </p>
                  </div>
                  <div className="ml-7 space-y-1">
                    {question.options.map((option) => {
                      const isSelected =
                        result?.selectedOptionIds.includes(option.id) ?? false;
                      const isCorrect =
                        result?.correctOptionIds.includes(option.id) ?? false;
                      let className = "text-sm";
                      if (isCorrect)
                        className +=
                          " font-medium text-green-700 dark:text-green-400";
                      else if (isSelected && !result?.correct)
                        className +=
                          " text-red-600 dark:text-red-400 line-through";
                      return (
                        <p key={option.id} className={className}>
                          {isCorrect ? "✓ " : isSelected ? "✗ " : "  "}
                          {option.optionText}
                        </p>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Retake / exhausted */}
          {!quizResult.passed &&
            (attemptsRemaining > 0 ? (
              <div className="mt-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedAnswers({});
                    setRetaking(true);
                  }}
                >
                  <RotateCcw className="mr-2 size-4" />
                  Retake Exam
                </Button>
                <p className="mt-2 text-sm text-muted-foreground">
                  {attemptsRemaining} of {maxAttempts} attempt
                  {attemptsRemaining === 1 ? "" : "s"} remaining.
                </p>
              </div>
            ) : (
              <div className="mt-6 rounded-lg bg-amber-50 p-4 dark:bg-amber-950">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  You've used all {maxAttempts} attempts for this exam, so it
                  can no longer be retaken.
                </p>
              </div>
            ))}
        </CardContent>
      </Card>
    );
  }

  if (!showQuiz && bestAttempt?.passed) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="size-5 text-green-600" />
              <span className="font-medium">{quiz.title}</span>
              <span className="text-sm text-muted-foreground">
                — Best score: {Math.round(bestAttempt.score * 100)}%
              </span>
            </div>
            {attemptsRemaining > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowQuiz(true)}
              >
                <RotateCcw className="mr-2 size-4" />
                Retake
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (attemptsRemaining <= 0) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <HelpCircle className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">{quiz.title}</h2>
          </div>
          <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              You've used all {maxAttempts} attempts for this exam, so it can no
              longer be retaken.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <HelpCircle className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">{quiz.title}</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Answer all questions and submit. Passing score:{" "}
          {Math.round(quiz.passingScore * 100)}%. {attemptsRemaining} of{" "}
          {maxAttempts} attempt{attemptsRemaining === 1 ? "" : "s"} remaining.
        </p>

        <quizFetcher.Form method="post" onSubmit={() => setRetaking(false)}>
          <input type="hidden" name="intent" value="submit-quiz" />
          <input type="hidden" name="quizId" value={quiz.id} />

          <div className="space-y-6">
            {quiz.questions.map((question, qIndex) => {
              const isMulti = question.questionType === "multi_select";
              const selected = selectedAnswers[question.id] ?? [];
              return (
                <div key={question.id} className="rounded-lg border p-4">
                  <p className="mb-1 font-medium">
                    {qIndex + 1}. {question.questionText}
                  </p>
                  {isMulti && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      Select all that apply.
                    </p>
                  )}
                  <div className="space-y-2">
                    {question.options.map((option) => {
                      const checked = selected.includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"
                        >
                          <input
                            type={isMulti ? "checkbox" : "radio"}
                            name={`question-${question.id}`}
                            value={option.id}
                            checked={checked}
                            onChange={() =>
                              setSelectedAnswers((prev) => {
                                if (!isMulti) {
                                  return {
                                    ...prev,
                                    [question.id]: [option.id],
                                  };
                                }
                                const current = prev[question.id] ?? [];
                                const next = current.includes(option.id)
                                  ? current.filter((id) => id !== option.id)
                                  : [...current, option.id];
                                return { ...prev, [question.id]: next };
                              })
                            }
                            className={`size-4 accent-primary ${isMulti ? "rounded" : ""}`}
                          />
                          <span className="text-sm">{option.optionText}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6">
            <Button type="submit" disabled={!allAnswered || isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Quiz"}
            </Button>
            {!allAnswered && (
              <p className="mt-2 text-sm text-muted-foreground">
                Please answer all questions before submitting.
              </p>
            )}
          </div>
        </quizFetcher.Form>
      </CardContent>
    </Card>
  );
}

function formatCommentDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type NoteData = {
  id: number;
  lessonId: number;
  userId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

function NotesPanel({
  notes,
  notesFetcher,
}: {
  notes: NoteData[];
  notesFetcher: ReturnType<typeof useFetcher>;
}) {
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    const data = notesFetcher.data as
      | { noteSuccess?: boolean; noteError?: string }
      | undefined;
    if (!data) return;
    if (data.noteError) {
      toast.error(data.noteError);
    } else if (data.noteSuccess) {
      setNewNote("");
      setEditingId(null);
    }
  }, [notesFetcher.data]);

  const isBusy = notesFetcher.state !== "idle";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <StickyNote className="size-5 text-primary" />
          <h2 className="font-semibold">My Notes</h2>
        </div>

        {/* New note */}
        <notesFetcher.Form method="post">
          <input type="hidden" name="intent" value="add-note" />
          <Textarea
            name="content"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Write a note for this lesson…"
            rows={3}
            className="resize-none text-sm"
          />
          <Button
            type="submit"
            size="sm"
            className="mt-2 w-full"
            disabled={isBusy || !newNote.trim()}
          >
            <Plus className="mr-1.5 size-4" />
            Add note
          </Button>
        </notesFetcher.Form>

        {/* Existing notes */}
        <div className="mt-4 space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes yet. Jot down key takeaways as you learn.
            </p>
          ) : (
            notes.map((note) =>
              editingId === note.id ? (
                <notesFetcher.Form
                  method="post"
                  key={note.id}
                  className="rounded-lg border p-3"
                >
                  <input type="hidden" name="intent" value="update-note" />
                  <input type="hidden" name="noteId" value={note.id} />
                  <Textarea
                    name="content"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    className="resize-none text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isBusy || !editText.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </notesFetcher.Form>
              ) : (
                <div key={note.id} className="rounded-lg border p-3">
                  <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {formatCommentDate(note.updatedAt)}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditText(note.content);
                        }}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Edit note"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <notesFetcher.Form method="post">
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
                      </notesFetcher.Form>
                    </div>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type CommentData = {
  id: number;
  userId: number;
  parentId: number | null;
  content: string;
  isQuestion: boolean;
  createdAt: string;
  userName: string;
  userAvatarUrl: string | null;
  userRole: string;
  score: number;
  myVote: number;
};
type CommentNode = CommentData & {
  replies: CommentData[];
  answeredByInstructor: boolean;
};

function CommentsSection({
  comments,
  isInstructor,
  currentUserId,
}: {
  comments: CommentNode[];
  isInstructor: boolean;
  currentUserId: number | null;
}) {
  const fetcher = useFetcher<{
    commentSuccess?: boolean;
    commentError?: string;
  }>();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.commentSuccess) {
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (fetcher.data?.commentError) {
      toast.error(fetcher.data.commentError);
    }
  }, [fetcher.data]);

  const isPosting = fetcher.state !== "idle";
  const totalCount = comments.reduce((sum, c) => sum + 1 + c.replies.length, 0);

  const [sort, setSort] = useState<"newest" | "helpful">("newest");
  const [filter, setFilter] = useState<"all" | "questions" | "unanswered">(
    "all"
  );

  const visible = comments
    .filter((c) => {
      if (filter === "questions") return c.isQuestion;
      if (filter === "unanswered")
        return c.isQuestion && !c.answeredByInstructor;
      return true;
    })
    .sort((a, b) => {
      if (sort === "helpful") return b.score - a.score;
      // "newest" — most recent first (createdAt is ISO and sortable).
      return b.createdAt.localeCompare(a.createdAt);
    });

  const questionCount = comments.filter((c) => c.isQuestion).length;

  return (
    <section className="mb-8 border-t pt-8">
      <div className="mb-6 flex items-center gap-2">
        <MessageSquare className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Discussion</h2>
        <span className="text-sm text-muted-foreground">({totalCount})</span>
      </div>

      <fetcher.Form ref={formRef} method="post" className="mb-8">
        <input type="hidden" name="intent" value="add-comment" />
        <Textarea
          name="content"
          placeholder="Ask a question or share a thought about this lesson..."
          required
          rows={3}
          className="mb-3"
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="isQuestion"
              className="size-4 accent-primary"
            />
            Post as a question
          </label>
          <Button type="submit" disabled={isPosting}>
            {isPosting ? "Posting..." : "Post comment"}
          </Button>
        </div>
      </fetcher.Form>

      {/* Sort + Q&A filters */}
      {comments.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex rounded-lg border p-0.5">
            {(
              [
                { v: "newest", label: "Newest" },
                { v: "helpful", label: "Most helpful" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setSort(opt.v)}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors",
                  sort === opt.v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border p-0.5">
            {(
              [
                { v: "all", label: "All" },
                { v: "questions", label: "Questions" },
                { v: "unanswered", label: "Unanswered" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setFilter(opt.v)}
                disabled={opt.v !== "all" && questionCount === 0}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  filter === opt.v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet. Be the first to start the discussion.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments match this filter.
        </p>
      ) : (
        <ul className="space-y-6">
          {visible.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isInstructor={isInstructor}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentItem({
  comment,
  isInstructor,
  currentUserId,
}: {
  comment: CommentNode;
  isInstructor: boolean;
  currentUserId: number | null;
}) {
  const [showReply, setShowReply] = useState(false);
  const replyFetcher = useFetcher<{ commentSuccess?: boolean }>();
  const replyFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (replyFetcher.state === "idle" && replyFetcher.data?.commentSuccess) {
      replyFormRef.current?.reset();
      setShowReply(false);
    }
  }, [replyFetcher.state, replyFetcher.data]);

  const isReplying = replyFetcher.state !== "idle";

  return (
    <li>
      <CommentBody
        comment={comment}
        currentUserId={currentUserId}
        answered={comment.answeredByInstructor}
      />

      {/* Only the instructor can reply to a comment */}
      {isInstructor && (
        <div className="ml-11 mt-2">
          {!showReply ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReply(true)}
            >
              <Reply className="mr-1.5 size-3.5" />
              Reply
            </Button>
          ) : (
            <replyFetcher.Form
              ref={replyFormRef}
              method="post"
              className="mt-2"
            >
              <input type="hidden" name="intent" value="add-comment" />
              <input type="hidden" name="parentId" value={comment.id} />
              <Textarea
                name="content"
                placeholder="Write a reply..."
                required
                rows={2}
                className="mb-2"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isReplying}>
                  {isReplying ? "Replying..." : "Post reply"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReply(false)}
                >
                  Cancel
                </Button>
              </div>
            </replyFetcher.Form>
          )}
        </div>
      )}

      {comment.replies.length > 0 && (
        <ul className="ml-11 mt-4 space-y-4 border-l pl-4">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody comment={reply} currentUserId={currentUserId} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CommentBody({
  comment,
  currentUserId,
  answered = false,
}: {
  comment: CommentData;
  currentUserId: number | null;
  answered?: boolean;
}) {
  const deleteFetcher = useFetcher();
  const voteFetcher = useFetcher();
  const canDelete = comment.userId === currentUserId;
  const isAuthorInstructor = comment.userRole === UserRole.Instructor;
  const isDeleting = deleteFetcher.state !== "idle";
  const canVote = currentUserId != null && comment.userId !== currentUserId;

  // Optimistic vote: reflect the in-flight direction immediately.
  const pendingValue = voteFetcher.formData?.get("value");
  const myVote =
    pendingValue != null
      ? comment.myVote === Number(pendingValue)
        ? 0 // re-clicking the same direction removes it
        : Number(pendingValue)
      : comment.myVote;
  const score = comment.score - comment.myVote + myVote;

  return (
    <div className={cn("flex gap-3", isDeleting && "opacity-50")}>
      <UserAvatar
        name={comment.userName}
        avatarUrl={comment.userAvatarUrl}
        className="size-8 shrink-0"
      />
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{comment.userName}</span>
          {isAuthorInstructor && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Instructor
            </span>
          )}
          {comment.isQuestion && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              <HelpCircle className="size-3" />
              Question
            </span>
          )}
          {answered && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
              <CheckCircle2 className="size-3" />
              Answered
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatCommentDate(comment.createdAt)}
          </span>
          {canDelete && (
            <deleteFetcher.Form method="post" className="ml-auto">
              <input type="hidden" name="intent" value="delete-comment" />
              <input type="hidden" name="commentId" value={comment.id} />
              <button
                type="submit"
                disabled={isDeleting}
                title="Delete comment"
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </deleteFetcher.Form>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
          {comment.content}
        </p>

        {/* Up/down votes */}
        <div className="mt-2 flex items-center gap-1">
          <voteFetcher.Form method="post" className="contents">
            <input type="hidden" name="intent" value="vote-comment" />
            <input type="hidden" name="commentId" value={comment.id} />
            <button
              type="submit"
              name="value"
              value="1"
              disabled={!canVote}
              title={canVote ? "Helpful" : "You can't vote on this"}
              className={cn(
                "rounded p-1 transition-colors disabled:opacity-40",
                myVote === 1
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
                canVote && "cursor-pointer"
              )}
            >
              <ChevronUp className="size-4" />
            </button>
            <span
              className={cn(
                "min-w-5 text-center text-sm font-medium tabular-nums",
                score > 0
                  ? "text-primary"
                  : score < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
            >
              {score}
            </span>
            <button
              type="submit"
              name="value"
              value="-1"
              disabled={!canVote}
              title={canVote ? "Not helpful" : "You can't vote on this"}
              className={cn(
                "rounded p-1 transition-colors disabled:opacity-40",
                myVote === -1
                  ? "text-destructive"
                  : "text-muted-foreground hover:text-foreground",
                canVote && "cursor-pointer"
              )}
            >
              <ChevronDown className="size-4" />
            </button>
          </voteFetcher.Form>
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this lesson.";

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
          <Link to="/dashboard">
            <Button>My Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
