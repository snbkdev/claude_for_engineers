import { data } from "react-router";
import * as v from "valibot";
import type { Route } from "./+types/api.video-tracking";
import { getCurrentUserId } from "~/lib/session";
import {
  logWatchEvent,
  calculateWatchProgress,
  isVideoComplete,
} from "~/services/videoTrackingService";
import { getLessonById } from "~/services/lessonService";
import { getModuleById } from "~/services/moduleService";
import { isUserEnrolled } from "~/services/enrollmentService";
import {
  markLessonComplete,
  isLessonCompleted,
} from "~/services/progressService";
import { maybeCompleteCourse } from "~/services/certificateService";
import { parseJsonBody } from "~/lib/validation";

const videoTrackingSchema = v.object({
  lessonId: v.number(),
  eventType: v.string(),
  positionSeconds: v.number(),
});

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const parsed = await parseJsonBody(request, videoTrackingSchema);

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const { lessonId, eventType, positionSeconds } = parsed.data;

  logWatchEvent({
    userId: currentUserId,
    lessonId,
    eventType,
    positionSeconds,
  });

  // Auto-complete the lesson once enough of the video has been watched — the
  // video analogue of passing a quiz. Only the transition into Completed is
  // reported, so repeat progress events don't re-fire the client toast.
  let autoCompleted = false;
  const lesson = getLessonById(lessonId);
  const mod = lesson ? getModuleById(lesson.moduleId) : null;

  if (
    lesson &&
    mod &&
    isUserEnrolled({ userId: currentUserId, courseId: mod.courseId }) &&
    !isLessonCompleted({ userId: currentUserId, lessonId })
  ) {
    const progress = calculateWatchProgress({
      userId: currentUserId,
      lessonId,
      videoDurationSeconds: (lesson.durationMinutes ?? 0) * 60,
    });

    if (isVideoComplete({ progress, eventType })) {
      markLessonComplete({ userId: currentUserId, lessonId });
      maybeCompleteCourse({ userId: currentUserId, courseId: mod.courseId });
      autoCompleted = true;
    }
  }

  return { success: true, autoCompleted };
}
