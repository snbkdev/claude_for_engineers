import {
  getCourseById,
  setCourseModeration,
  updateCourseStatus,
} from "./courseService";
import { getUsersByRole } from "./userService";
import { createNotification } from "./notificationService";
import {
  CourseStatus,
  ModerationStatus,
  NotificationType,
  UserRole,
} from "~/db/schema";

// ─── Moderation Service ───
// Course review workflow on top of the courses table. Instructors self-publish
// (a course goes live immediately); publishing also flags it for admin review.
// An admin then approves (stays published) or rejects (sent back to draft with a
// reason). Each transition notifies the relevant party (admins on submit, the
// instructor on approve/reject). Column writes go through courseService; this
// module owns the orchestration + notifications.

export type ModerationResult = { ok: true } | { ok: false; error: string };

// Flag a (just-published) course for admin review and notify every admin.
// Called from the instructor publish path.
export function submitForReview(courseId: number): ModerationResult {
  const course = getCourseById(courseId);
  if (!course) return { ok: false, error: "Course not found" };

  setCourseModeration({
    id: courseId,
    moderationStatus: ModerationStatus.Pending,
    rejectionReason: null,
  });

  for (const admin of getUsersByRole(UserRole.Admin)) {
    createNotification(
      admin.id,
      NotificationType.CourseModeration,
      "Course awaiting review",
      `"${course.title}" was published and is awaiting moderation.`,
      "/admin/moderation"
    );
  }

  return { ok: true };
}

// Admin approves a pending course: it stays published, the queue clears, and the
// instructor is told.
export function approveCourse(courseId: number): ModerationResult {
  const course = getCourseById(courseId);
  if (!course) return { ok: false, error: "Course not found" };

  setCourseModeration({
    id: courseId,
    moderationStatus: ModerationStatus.Approved,
    rejectionReason: null,
  });

  createNotification(
    course.instructorId,
    NotificationType.CourseModeration,
    "Course approved",
    `Your course "${course.title}" passed moderation and stays published.`,
    `/instructor/${course.id}`
  );

  return { ok: true };
}

// Admin rejects a pending course: it's sent back to draft (removed from the
// catalog) with a reason, and the instructor is told so they can fix + republish.
export function rejectCourse(opts: {
  courseId: number;
  reason: string;
}): ModerationResult {
  const reason = opts.reason.trim();
  if (!reason) return { ok: false, error: "A rejection reason is required" };

  const course = getCourseById(opts.courseId);
  if (!course) return { ok: false, error: "Course not found" };

  updateCourseStatus(opts.courseId, CourseStatus.Draft);
  setCourseModeration({
    id: opts.courseId,
    moderationStatus: ModerationStatus.Rejected,
    rejectionReason: reason,
  });

  createNotification(
    course.instructorId,
    NotificationType.CourseModeration,
    "Course needs changes",
    `Your course "${course.title}" was rejected: ${reason}`,
    `/instructor/${course.id}`
  );

  return { ok: true };
}
