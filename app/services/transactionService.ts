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
  TeamMemberRole,
  NotificationType,
} from "~/db/schema";
import { calculatePppPrice } from "~/lib/ppp";
import { getTeamForAdmin, getTeamAdmins } from "./teamService";
import { findEnrollment } from "./enrollmentService";
import { getCouponByCode, generateCoupons } from "./couponService";
import { createPurchase } from "./purchaseService";
import { createNotification } from "./notificationService";
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

  return { ok: true, data: result };
}
