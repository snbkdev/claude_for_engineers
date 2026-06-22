import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  purchases,
  coupons,
  enrollments,
  teams,
  teamMembers,
  courses,
  users,
  gifts,
  TeamMemberRole,
  NotificationType,
} from "~/db/schema";
import { calculatePppPrice } from "~/lib/ppp";
import { getTeamForAdmin, getTeamAdmins } from "./teamService";
import { findEnrollment } from "./enrollmentService";
import { getCouponByCode, generateCoupons } from "./couponService";
import { createPurchase } from "./purchaseService";
import { createGift, getGiftByCode, generateGiftCode } from "./giftService";
import { createNotification } from "./notificationService";
import {
  countWatchedLessonsInCourse,
  countViewersInCourse,
} from "./videoTrackingService";
import {
  validatePromo,
  computeDiscountedPrice,
  incrementPromoRedemption,
  type Promo,
} from "./promoService";

// ─── Transaction Service ───
// Deep module owning the full purchase/coupon/enrollment lifecycle behind a
// small interface: PPP price resolution, individual-vs-team branching, atomic
// all-or-nothing writes (one db.transaction per write), coupon generation,
// coupon redemption + validation, enrollment creation, and the *triggering*
// of notifications (fired AFTER commit so a notification failure can never roll
// back a paid enrollment).
//
// All writes wrap their mutations in db.transaction(...). better-sqlite3
// transactions are synchronous and run the whole callback on one connection, so
// the reused leaf services (createPurchase, generateCoupons, …) participate in
// the same transaction and roll back together on throw.
//
// Functions with multiple same-typed params take a single object param.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// The routes already hold the full course row; this avoids a re-fetch and lets
// the module own PPP price math and the "can't buy your own course" rule.
type CourseLike = {
  id: number;
  price: number;
  pppEnabled: boolean;
  instructorId: number;
};

// ─── Shared country predicate (single source of truth) ───
// A coupon may only be redeemed from the same country as the purchaser. A
// purchase with no recorded country imposes no restriction. Reused by redeem()
// and by the redeem route's loader so the two can never disagree.
export function couponCountryMatches(opts: {
  purchaseCountry: string | null;
  userCountry: string | null;
}): boolean {
  if (!opts.purchaseCountry) return true;
  return opts.purchaseCountry === (opts.userCountry ?? "");
}

function resolvePrice(course: CourseLike, country: string | null): number {
  return course.pppEnabled
    ? calculatePppPrice(course.price, country)
    : course.price;
}

// Resolves the per-seat price for a purchase: PPP first, then an optional promo
// code applied on top (a pricing strategy). Returns the validated promo so the
// caller can record its redemption inside the purchase transaction. A bad promo
// code fails the whole purchase rather than silently charging full price.
function resolvePricing(opts: {
  course: CourseLike;
  country: string | null;
  promoCode?: string | null;
}): Result<{ unitPrice: number; promo: Promo | null }> {
  const base = resolvePrice(opts.course, opts.country);
  const code = opts.promoCode?.trim();
  if (!code) {
    return { ok: true, data: { unitPrice: base, promo: null } };
  }

  const validation = validatePromo({ code });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  return {
    ok: true,
    data: {
      unitPrice: computeDiscountedPrice(base, validation.promo),
      promo: validation.promo,
    },
  };
}

// ─── Notifications (fired after commit) ───

function notifyInstructorOfEnrollment(opts: {
  courseId: number;
  userId: number;
}) {
  const course = db
    .select({ instructorId: courses.instructorId, title: courses.title })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .get();
  const student = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, opts.userId))
    .get();
  if (!course || !student) return;

  createNotification(
    course.instructorId,
    NotificationType.Enrollment,
    "New Enrollment",
    `${student.name} enrolled in ${course.title}`,
    `/instructor/${opts.courseId}/students`
  );
}

// Confirmation to the learner who just gained access (self purchase, coupon
// redemption, or gift claim) — their own "you're enrolled" email/in-app note.
function notifyLearnerEnrolled(opts: { userId: number; courseId: number }) {
  const course = db
    .select({ title: courses.title, slug: courses.slug })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .get();
  if (!course) return;

  createNotification(
    opts.userId,
    NotificationType.PurchaseConfirmation,
    "You're enrolled!",
    `You now have access to ${course.title}. Happy learning!`,
    `/courses/${course.slug}`
  );
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

  // Per-course seat counts for this team, reflecting the committed state.
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

// ─── Entry point: buy a course for yourself ───
// Records the purchase + enrolls the buyer atomically, then notifies the
// instructor. PPP applied internally.
export function buyForSelf(opts: {
  userId: number;
  course: CourseLike;
  country: string | null;
  promoCode?: string | null;
}): Result<{
  purchase: typeof purchases.$inferSelect;
  enrollment: typeof enrollments.$inferSelect;
}> {
  if (opts.course.instructorId === opts.userId) {
    return { ok: false, error: "You can't purchase your own course" };
  }

  if (findEnrollment({ userId: opts.userId, courseId: opts.course.id })) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const pricing = resolvePricing({
    course: opts.course,
    country: opts.country,
    promoCode: opts.promoCode,
  });
  if (!pricing.ok) return pricing;
  const { unitPrice, promo } = pricing.data;

  const result = db.transaction(() => {
    const purchase = createPurchase({
      userId: opts.userId,
      courseId: opts.course.id,
      pricePaid: unitPrice,
      country: opts.country,
    });
    const enrollment = db
      .insert(enrollments)
      .values({ userId: opts.userId, courseId: opts.course.id })
      .returning()
      .get();
    if (promo) incrementPromoRedemption(promo.id);
    return { purchase, enrollment };
  });

  notifyInstructorOfEnrollment({
    courseId: opts.course.id,
    userId: opts.userId,
  });
  notifyLearnerEnrolled({ userId: opts.userId, courseId: opts.course.id });

  return { ok: true, data: result };
}

// ─── Entry point: buy team seats ───
// Records the purchase, resolves/creates the buyer's team, and generates N
// coupons atomically. The buyer is intentionally NOT enrolled.
export function buyForTeam(opts: {
  userId: number;
  course: CourseLike;
  country: string | null;
  quantity: number;
  promoCode?: string | null;
}): Result<{
  purchase: typeof purchases.$inferSelect;
  team: typeof teams.$inferSelect;
  coupons: (typeof coupons.$inferSelect)[];
}> {
  if (opts.course.instructorId === opts.userId) {
    return { ok: false, error: "You can't purchase your own course" };
  }

  const pricing = resolvePricing({
    course: opts.course,
    country: opts.country,
    promoCode: opts.promoCode,
  });
  if (!pricing.ok) return pricing;
  const { unitPrice, promo } = pricing.data;
  // Discount applies per seat; the promo counts as one redemption per checkout.
  const pricePaid = unitPrice * opts.quantity;

  const result = db.transaction(() => {
    const purchase = createPurchase({
      userId: opts.userId,
      courseId: opts.course.id,
      pricePaid,
      country: opts.country,
    });
    if (promo) incrementPromoRedemption(promo.id);

    // Resolve or create the buyer's team within the transaction.
    let team = getTeamForAdmin(opts.userId);
    if (!team) {
      team = db.insert(teams).values({}).returning().get();
      db.insert(teamMembers)
        .values({
          teamId: team.id,
          userId: opts.userId,
          role: TeamMemberRole.Admin,
        })
        .run();
    }

    const created = generateCoupons({
      teamId: team.id,
      courseId: opts.course.id,
      purchaseId: purchase.id,
      quantity: opts.quantity,
    });

    return { purchase, team, coupons: created };
  });

  return { ok: true, data: result };
}

// ─── Entry point: redeem a coupon ───
// Validates (exists / unconsumed / not-already-enrolled / country), then marks
// the coupon consumed and enrolls the user atomically, then notifies team
// admins with committed seat counts.
export function redeem(opts: {
  code: string;
  userId: number;
  country: string | null;
}): Result<{ enrollment: typeof enrollments.$inferSelect }> {
  const coupon = getCouponByCode(opts.code);
  if (!coupon) {
    return { ok: false, error: "Coupon not found" };
  }

  if (coupon.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  if (findEnrollment({ userId: opts.userId, courseId: coupon.courseId })) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId))
    .get();

  if (
    !couponCountryMatches({
      purchaseCountry: purchase?.country ?? null,
      userCountry: opts.country,
    })
  ) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  const result = db.transaction(() => {
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

    return { enrollment };
  });

  notifyTeamAdminsOfRedemption({
    teamId: coupon.teamId,
    courseId: coupon.courseId,
    redeemerUserId: opts.userId,
  });
  notifyLearnerEnrolled({ userId: opts.userId, courseId: coupon.courseId });

  return { ok: true, data: result };
}

// ─── Entry point: buy a course as a gift ───
// Records the purchase + a gift row (with a unique claim code) atomically. The
// sender is NOT enrolled; the recipient claims via the code. PPP + promo apply.
export function buyGift(opts: {
  userId: number;
  course: CourseLike;
  country: string | null;
  recipientEmail: string;
  message?: string | null;
  promoCode?: string | null;
}): Result<{
  purchase: typeof purchases.$inferSelect;
  gift: typeof gifts.$inferSelect;
}> {
  if (opts.course.instructorId === opts.userId) {
    return { ok: false, error: "You can't gift your own course" };
  }

  const pricing = resolvePricing({
    course: opts.course,
    country: opts.country,
    promoCode: opts.promoCode,
  });
  if (!pricing.ok) return pricing;
  const { unitPrice, promo } = pricing.data;

  const result = db.transaction(() => {
    const purchase = createPurchase({
      userId: opts.userId,
      courseId: opts.course.id,
      pricePaid: unitPrice,
      country: opts.country,
    });
    if (promo) incrementPromoRedemption(promo.id);
    const gift = createGift({
      purchaseId: purchase.id,
      courseId: opts.course.id,
      senderId: opts.userId,
      recipientEmail: opts.recipientEmail,
      message: opts.message ?? null,
      code: generateGiftCode(),
    });
    return { purchase, gift };
  });

  return { ok: true, data: result };
}

// ─── Entry point: claim a gift ───
// Validates (exists / unclaimed / not-already-enrolled), then marks the gift
// claimed and enrolls the claimer atomically; afterwards notifies the course
// instructor (new enrollment) and the gift sender (their gift was claimed).
export function claimGift(opts: {
  code: string;
  userId: number;
}): Result<{ enrollment: typeof enrollments.$inferSelect; courseId: number }> {
  const gift = getGiftByCode(opts.code);
  if (!gift) {
    return { ok: false, error: "Gift not found" };
  }
  if (gift.claimedAt !== null) {
    return { ok: false, error: "This gift has already been claimed" };
  }
  if (findEnrollment({ userId: opts.userId, courseId: gift.courseId })) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const result = db.transaction(() => {
    db.update(gifts)
      .set({
        claimedByUserId: opts.userId,
        claimedAt: new Date().toISOString(),
      })
      .where(eq(gifts.id, gift.id))
      .run();

    const enrollment = db
      .insert(enrollments)
      .values({ userId: opts.userId, courseId: gift.courseId })
      .returning()
      .get();

    return { enrollment };
  });

  notifyInstructorOfEnrollment({
    courseId: gift.courseId,
    userId: opts.userId,
  });
  notifyGiftClaimed({
    senderId: gift.senderId,
    courseId: gift.courseId,
    claimerUserId: opts.userId,
  });
  notifyLearnerEnrolled({ userId: opts.userId, courseId: gift.courseId });

  return {
    ok: true,
    data: { enrollment: result.enrollment, courseId: gift.courseId },
  };
}

function notifyGiftClaimed(opts: {
  senderId: number;
  courseId: number;
  claimerUserId: number;
}) {
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .get();
  const claimer = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, opts.claimerUserId))
    .get();
  if (!course || !claimer) return;

  createNotification(
    opts.senderId,
    NotificationType.GiftClaimed,
    "Gift Claimed",
    `${claimer.name} claimed your gift of ${course.title}`,
    "/gifts"
  );
}

// ─── Refunds / cancellation ───
// Students may cancel their own purchase within REFUND_WINDOW_DAYS; admins may
// refund any purchase at any time. A refund marks the purchase refunded and
// unwinds the access it granted — atomically — then notifies the instructor.

export const REFUND_WINDOW_DAYS = 30;
const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Self-service refunds are only available before the buyer has watched more than
// this many distinct lessons in the course (you can sample a few, not consume it
// and then refund). Admins can override.
export const MAX_REFUND_WATCHED_LESSONS = 3;

export function isWithinRefundWindow(
  createdAt: string,
  now: Date = new Date()
): boolean {
  return now.getTime() - new Date(createdAt).getTime() <= REFUND_WINDOW_MS;
}

function notifyInstructorOfRefund(opts: { courseId: number; userId: number }) {
  const course = db
    .select({ instructorId: courses.instructorId, title: courses.title })
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .get();
  const student = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, opts.userId))
    .get();
  if (!course || !student) return;

  createNotification(
    course.instructorId,
    NotificationType.Refund,
    "Purchase Refunded",
    `${student.name}'s purchase of ${course.title} was refunded`,
    `/instructor/${opts.courseId}/students`
  );
}

export function refund(opts: {
  purchaseId: number;
  requestedByUserId: number;
  isAdmin?: boolean;
  now?: Date;
}): Result<{ team: boolean; couponsRevoked: number }> {
  const now = opts.now ?? new Date();
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, opts.purchaseId))
    .get();
  if (!purchase) {
    return { ok: false, error: "Purchase not found" };
  }
  if (purchase.refundedAt) {
    return { ok: false, error: "This purchase has already been refunded" };
  }

  // A team purchase is the one referenced by generated coupons.
  const purchaseCoupons = db
    .select()
    .from(coupons)
    .where(eq(coupons.purchaseId, purchase.id))
    .all();
  const isTeam = purchaseCoupons.length > 0;

  const isAdmin = opts.isAdmin ?? false;
  if (!isAdmin) {
    if (purchase.userId !== opts.requestedByUserId) {
      return { ok: false, error: "You can only cancel your own purchase" };
    }
    if (!isWithinRefundWindow(purchase.createdAt, now)) {
      return {
        ok: false,
        error: `Refunds are only available within ${REFUND_WINDOW_DAYS} days of purchase`,
      };
    }
    if (isTeam) {
      // Gate on how many seat holders have already started watching.
      const redeemerIds = purchaseCoupons
        .map((c) => c.redeemedByUserId)
        .filter((id): id is number => id !== null);
      const viewers = countViewersInCourse({
        courseId: purchase.courseId,
        userIds: redeemerIds,
      });
      if (viewers > MAX_REFUND_WATCHED_LESSONS) {
        return {
          ok: false,
          error: `Refunds are only available before more than ${MAX_REFUND_WATCHED_LESSONS} team members have started watching`,
        };
      }
    } else {
      const watched = countWatchedLessonsInCourse({
        userId: purchase.userId,
        courseId: purchase.courseId,
      });
      if (watched > MAX_REFUND_WATCHED_LESSONS) {
        return {
          ok: false,
          error: `Refunds are only available before watching more than ${MAX_REFUND_WATCHED_LESSONS} lessons`,
        };
      }
    }
  }

  db.transaction(() => {
    db.update(purchases)
      .set({ refundedAt: now.toISOString() })
      .where(eq(purchases.id, purchase.id))
      .run();

    if (isTeam) {
      // Revoke access granted by this purchase: drop enrollments of anyone who
      // redeemed a seat, then delete all the coupons.
      for (const c of purchaseCoupons) {
        if (c.redeemedByUserId !== null) {
          db.delete(enrollments)
            .where(
              and(
                eq(enrollments.userId, c.redeemedByUserId),
                eq(enrollments.courseId, c.courseId)
              )
            )
            .run();
        }
      }
      db.delete(coupons).where(eq(coupons.purchaseId, purchase.id)).run();
    } else {
      // Self purchase: remove the buyer's enrollment.
      db.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, purchase.userId),
            eq(enrollments.courseId, purchase.courseId)
          )
        )
        .run();
    }
  });

  notifyInstructorOfRefund({
    courseId: purchase.courseId,
    userId: purchase.userId,
  });

  return {
    ok: true,
    data: { team: isTeam, couponsRevoked: purchaseCoupons.length },
  };
}
