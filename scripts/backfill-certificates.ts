/**
 * Backfill course-completion certificates for students who already finished a
 * course before the certificates feature existed.
 *
 * "Finished" means 100% lesson progress — the same rule the live app uses — NOT
 * `enrollments.completedAt`, which was never set historically (the
 * `markEnrollmentComplete` call was dead code). Reuses the real
 * `maybeCompleteCourse`, so this also backfills the missing `completedAt` and is
 * fully idempotent: re-running it issues nothing new.
 *
 *   pnpm tsx scripts/backfill-certificates.ts            # apply
 *   pnpm tsx scripts/backfill-certificates.ts --dry-run  # preview only
 *
 * Runs against data.db (via ~/db), so stop the dev server or expect WAL sharing.
 */
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { enrollments, users, courses } from "~/db/schema";
import { calculateProgress } from "~/services/progressService";
import {
  getCertificateForCourse,
  maybeCompleteCourse,
} from "~/services/certificateService";

const dryRun = process.argv.includes("--dry-run");

function main() {
  const rows = db
    .select({
      userId: enrollments.userId,
      courseId: enrollments.courseId,
      studentName: users.name,
      courseTitle: courses.title,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.userId, users.id))
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .all();

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Scanning ${rows.length} enrollment(s)…\n`
  );

  let issued = 0;
  let alreadyHad = 0;
  let notComplete = 0;

  for (const row of rows) {
    const opts = { userId: row.userId, courseId: row.courseId };
    const progress = calculateProgress({
      ...opts,
      includeQuizzes: false,
      weightByDuration: false,
    });

    if (progress < 100) {
      notComplete++;
      continue;
    }

    const hadCert = !!getCertificateForCourse(opts);
    if (hadCert) {
      alreadyHad++;
      continue;
    }

    if (dryRun) {
      console.log(`  would issue → ${row.studentName} · ${row.courseTitle}`);
      issued++;
      continue;
    }

    const cert = maybeCompleteCourse(opts);
    if (cert) {
      issued++;
      console.log(
        `  issued ${cert.code} → ${row.studentName} · ${row.courseTitle}`
      );
    }
  }

  console.log(
    `\nDone. ${dryRun ? "Would issue" : "Issued"}: ${issued}, ` +
      `already had: ${alreadyHad}, not complete (<100%): ${notComplete}.`
  );
}

main();
