import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { db } from "~/db";
import { certificates, courses, users } from "~/db/schema";
import { calculateProgress } from "./progressService";
import { findEnrollment, markEnrollmentComplete } from "./enrollmentService";

// ─── Certificate Service ───
// Issues and verifies course-completion certificates. A certificate is created
// (idempotently) when a student reaches 100% progress; the unique code backs the
// public verification page and the PDF download.
// Functions with multiple same-typed params take a single object param.

function generateCode(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function getCertificateForCourse(opts: {
  userId: number;
  courseId: number;
}) {
  return db
    .select()
    .from(certificates)
    .where(
      and(
        eq(certificates.userId, opts.userId),
        eq(certificates.courseId, opts.courseId)
      )
    )
    .get();
}

// Idempotent: returns the existing certificate if one was already issued for this
// (userId, courseId), otherwise creates one with a fresh verification code.
export function issueCertificate(opts: { userId: number; courseId: number }) {
  const existing = getCertificateForCourse(opts);
  if (existing) return existing;

  return db
    .insert(certificates)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      code: generateCode(),
    })
    .returning()
    .get();
}

// Public lookup for the verification page / PDF. Joins the recipient + course so
// the caller never touches other tables. Returns null for an unknown code.
export function getCertificateByCode(code: string) {
  const row = db
    .select({
      code: certificates.code,
      issuedAt: certificates.issuedAt,
      recipientName: users.name,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(certificates)
    .innerJoin(users, eq(certificates.userId, users.id))
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(eq(certificates.code, code))
    .get();

  if (!row) return null;

  const instructor = db
    .select({ name: users.name })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .where(eq(courses.slug, row.courseSlug))
    .get();

  return { ...row, instructorName: instructor?.name ?? null };
}

export function getUserCertificates(userId: number) {
  return db
    .select({
      code: certificates.code,
      issuedAt: certificates.issuedAt,
      courseId: certificates.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(eq(certificates.userId, userId))
    .orderBy(desc(certificates.issuedAt))
    .all();
}

// Central completion detector, called after a lesson is completed (manually or by
// passing a quiz). When the course hits 100% it marks the enrollment complete
// (only if not already) and issues a certificate. Idempotent; returns the
// certificate when one is (or was already) issued, otherwise null.
export function maybeCompleteCourse(opts: {
  userId: number;
  courseId: number;
}) {
  const progress = calculateProgress({
    userId: opts.userId,
    courseId: opts.courseId,
    includeQuizzes: false,
    weightByDuration: false,
  });

  if (progress < 100) return null;

  const enrollment = findEnrollment(opts);
  if (!enrollment) return null;

  if (enrollment.completedAt === null) {
    markEnrollmentComplete(opts);
  }

  return issueCertificate(opts);
}
