import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  purchases,
  enrollments,
  courses,
  users,
  NotificationType,
} from "~/db/schema";
import crypto from "crypto";
import { createNotification } from "./notificationService";
import { getTeamAdmins } from "./teamService";

// ─── Coupon Service ───
// Handles coupon generation, redemption (with validation), and listing.
// Each coupon grants one seat for a specific course within a team.
// Functions with multiple same-typed params take a single object param.

function generateCode(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function generateCoupons(opts: {
  teamId: number;
  courseId: number;
  purchaseId: number;
  quantity: number;
}) {
  const created: (typeof coupons.$inferSelect)[] = [];
  for (let i = 0; i < opts.quantity; i++) {
    const coupon = db
      .insert(coupons)
      .values({
        teamId: opts.teamId,
        courseId: opts.courseId,
        code: generateCode(),
        purchaseId: opts.purchaseId,
      })
      .returning()
      .get();
    created.push(coupon);
  }
  return created;
}

export function getCouponByCode(code: string) {
  return db.select().from(coupons).where(eq(coupons.code, code)).get();
}

export function getCouponsForTeam(opts: { teamId: number; courseId?: number }) {
  if (opts.courseId !== undefined) {
    return db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.teamId, opts.teamId),
          eq(coupons.courseId, opts.courseId)
        )
      )
      .all();
  }
  return db.select().from(coupons).where(eq(coupons.teamId, opts.teamId)).all();
}

export type RedeemResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

export function redeemCoupon(opts: {
  code: string;
  userId: number;
  userCountry: string;
}): RedeemResult {
  // 1. Find the coupon
  const coupon = getCouponByCode(opts.code);
  if (!coupon) {
    return { ok: false, error: "Coupon not found" };
  }

  // 2. Check if already consumed
  if (coupon.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  // 3. Check if user is already enrolled
  const existingEnrollment = db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, opts.userId),
        eq(enrollments.courseId, coupon.courseId)
      )
    )
    .get();

  if (existingEnrollment) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  // 4. Country check: match purchaser's country
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== opts.userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  // 5. Redeem: mark coupon consumed + enroll user
  db.update(coupons)
    .set({
      redeemedByUserId: opts.userId,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.id, coupon.id))
    .run();

  const enrollment = db
    .insert(enrollments)
    .values({ userId: opts.userId, courseId: coupon.courseId })
    .returning()
    .get();

  // Notify every team admin that a seat was claimed.
  notifyTeamAdminsOfRedemption({
    teamId: coupon.teamId,
    courseId: coupon.courseId,
    redeemerUserId: opts.userId,
  });

  return { ok: true, enrollment };
}

function notifyTeamAdminsOfRedemption(opts: {
  teamId: number;
  courseId: number;
  redeemerUserId: number;
}) {
  const admins = getTeamAdmins(opts.teamId);
  if (admins.length === 0) return;

  const redeemer = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, opts.redeemerUserId))
    .get();
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .get();
  if (!redeemer || !course) return;

  // Per-course seat counts for this team, as of right after the redemption.
  const totalSeats =
    db
      .select({ count: sql<number>`count(*)` })
      .from(coupons)
      .where(
        and(
          eq(coupons.teamId, opts.teamId),
          eq(coupons.courseId, opts.courseId)
        )
      )
      .get()?.count ?? 0;
  const remainingSeats =
    db
      .select({ count: sql<number>`count(*)` })
      .from(coupons)
      .where(
        and(
          eq(coupons.teamId, opts.teamId),
          eq(coupons.courseId, opts.courseId),
          isNull(coupons.redeemedByUserId)
        )
      )
      .get()?.count ?? 0;

  const message = `${redeemer.name} redeemed a coupon for ${course.title} (${remainingSeats} of ${totalSeats} seats remaining)`;

  for (const admin of admins) {
    createNotification(
      admin.userId,
      NotificationType.CouponRedemption,
      "Seat Claimed",
      message,
      "/team"
    );
  }
}
