import { createHash } from "node:crypto";
import { data } from "react-router";
import type { Route } from "./+types/api.lessons.$lessonId.presence";
import { getCurrentUserId } from "~/lib/session";
import { getLessonById } from "~/services/lessonService";
import { getModuleById } from "~/services/moduleService";
import { getCourseById } from "~/services/courseService";
import { isUserEnrolled } from "~/services/enrollmentService";
import {
  join,
  touch,
  subscribe,
  getSnapshot,
  ensureSweepTimer,
  KEEPALIVE_MS,
  type PresenceSnapshot,
} from "~/lib/presence.server";

// ─── Lesson Presence (SSE transport) ───
// Production transport over the framework-agnostic ~/lib/presence.server core.
// Streams the live "N people watching this lesson" count to enrolled viewers.
// Resource route (no default export). Everyone who can view the lesson is
// counted (no opt-in); identity is anonymized — the registry key is the user id
// (so multiple tabs collapse to one), and the avatar seed is a one-way hash so
// the cluster shows stable-but-anonymous avatars.

/** Stable, non-identifying avatar seed derived from the user id. */
function anonymizedSeed(userId: number): string {
  return createHash("sha256")
    .update(`presence:${userId}`)
    .digest("hex")
    .slice(0, 12);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in", { status: 401 });
  }

  const lessonId = Number(params.lessonId);
  if (isNaN(lessonId)) {
    throw data("Invalid lesson", { status: 400 });
  }

  // Resolve lesson → module → course and gate on lesson access (enrolled
  // student or the course's instructor), mirroring the lesson route.
  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }
  const mod = getModuleById(lesson.moduleId);
  if (!mod) {
    throw data("Lesson not found", { status: 404 });
  }
  const course = getCourseById(mod.courseId);
  if (!course) {
    throw data("Lesson not found", { status: 404 });
  }
  const isInstructor = course.instructorId === currentUserId;
  const enrolled = isUserEnrolled({
    userId: currentUserId,
    courseId: course.id,
  });
  if (!isInstructor && !enrolled) {
    throw data("You don't have access to this lesson", { status: 403 });
  }

  const roomId = `lesson:${lessonId}`;
  // Server-derived identity — the user id keys the member (multiple tabs = one),
  // the avatar seed is anonymized.
  const key = String(currentUserId);
  const avatarSeed = anonymizedSeed(currentUserId);

  ensureSweepTimer();

  const encoder = new TextEncoder();
  let leave: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendSnapshot = (snapshot: PresenceSnapshot) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: presence\ndata: ${JSON.stringify(snapshot)}\n\n`
            )
          );
        } catch {
          // Controller already closed (client gone); cleanup handles the rest.
        }
      };

      // Subscribe before join so the client receives its own join event, then
      // register self (everyone watching is counted).
      sendSnapshot(getSnapshot(roomId));
      unsubscribe = subscribe(roomId, sendSnapshot);
      leave = join({ roomId, key, avatarSeed });

      // Keep-alive comment frame + heartbeat to refresh liveness.
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // closed; ignore
        }
        touch({ roomId, key });
      }, KEEPALIVE_MS);
      keepAlive.unref?.();

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (leave) leave();
    leave = null;
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable nginx buffering so frames flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
