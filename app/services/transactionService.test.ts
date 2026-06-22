import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  buyForSelf,
  buyForTeam,
  redeem,
  refund,
  couponCountryMatches,
  isWithinRefundWindow,
  REFUND_WINDOW_DAYS,
  MAX_REFUND_WATCHED_LESSONS,
} from "./transactionService";
import { getCouponByCode } from "./couponService";
import { findEnrollment } from "./enrollmentService";
import { createPromo, getPromoByCode } from "./promoService";
import { getNotifications } from "./notificationService";

// The full course row the routes hold.
function course() {
  return {
    id: base.course.id,
    price: base.course.price,
    pppEnabled: base.course.pppEnabled,
    instructorId: base.instructor.id,
  };
}

function createUser(name: string, email: string) {
  return testDb
    .insert(schema.users)
    .values({ name, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

// A paid course with PPP off, so promo math is isolated from PPP discounts.
function paidCourse(price: number) {
  const c = testDb
    .insert(schema.courses)
    .values({
      title: "Paid Course",
      slug: `paid-${Math.random().toString(36).slice(2)}`,
      description: "d",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
      price,
      pppEnabled: false,
    })
    .returning()
    .get();
  return {
    id: c.id,
    price: c.price,
    pppEnabled: c.pppEnabled,
    instructorId: base.instructor.id,
  };
}

// Record `count` distinct watched lessons in `courseId` for `userId` (one
// module + N lessons + one watch event each).
function watchLessons(opts: {
  userId: number;
  courseId: number;
  count: number;
}) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: opts.courseId, title: "M", position: 1 })
    .returning()
    .get();
  for (let i = 0; i < opts.count; i++) {
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `L${i}`, position: i })
      .returning()
      .get();
    testDb
      .insert(schema.videoWatchEvents)
      .values({
        userId: opts.userId,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 10,
      })
      .run();
  }
}

describe("transactionService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("couponCountryMatches", () => {
    it("allows any country when the purchase has none", () => {
      expect(
        couponCountryMatches({ purchaseCountry: null, userCountry: "PL" })
      ).toBe(true);
    });

    it("requires an exact match when the purchase has a country", () => {
      expect(
        couponCountryMatches({ purchaseCountry: "US", userCountry: "US" })
      ).toBe(true);
      expect(
        couponCountryMatches({ purchaseCountry: "US", userCountry: "PL" })
      ).toBe(false);
      expect(
        couponCountryMatches({ purchaseCountry: "US", userCountry: null })
      ).toBe(false);
    });
  });

  describe("buyForSelf", () => {
    it("records a purchase and enrolls the buyer atomically", () => {
      const result = buyForSelf({
        userId: base.user.id,
        course: course(),
        country: "US",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.purchase.userId).toBe(base.user.id);
      expect(result.data.enrollment.userId).toBe(base.user.id);
      expect(result.data.enrollment.courseId).toBe(base.course.id);

      const purchases = testDb
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.userId, base.user.id))
        .all();
      expect(purchases).toHaveLength(1);
    });

    it("applies the PPP price for a discounted country", () => {
      // Give the course a non-zero price so PPP has an effect.
      testDb
        .update(schema.courses)
        .set({ price: 10000, pppEnabled: true })
        .where(eq(schema.courses.id, base.course.id))
        .run();

      const result = buyForSelf({
        userId: base.user.id,
        course: {
          id: base.course.id,
          price: 10000,
          pppEnabled: true,
          instructorId: base.instructor.id,
        },
        country: "IN", // tier 3 → 50% off
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.purchase.pricePaid).toBe(5000);
    });

    it("notifies the course instructor", () => {
      buyForSelf({ userId: base.user.id, course: course(), country: "US" });

      const notifications = getNotifications(base.instructor.id, 10, 0);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(schema.NotificationType.Enrollment);
    });

    it("rejects a buyer who is already enrolled", () => {
      testDb
        .insert(schema.enrollments)
        .values({ userId: base.user.id, courseId: base.course.id })
        .run();

      const result = buyForSelf({
        userId: base.user.id,
        course: course(),
        country: "US",
      });
      expect(result.ok).toBe(false);
    });

    it("rejects the instructor buying their own course", () => {
      const result = buyForSelf({
        userId: base.instructor.id,
        course: course(),
        country: "US",
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toBe("You can't purchase your own course");

      // Nothing recorded.
      const purchases = testDb
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.userId, base.instructor.id))
        .all();
      expect(purchases).toHaveLength(0);
    });
  });

  describe("buyForTeam", () => {
    it("creates a purchase, team, and N coupons; buyer is not enrolled", () => {
      const result = buyForTeam({
        userId: base.user.id,
        course: course(),
        country: "US",
        quantity: 3,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.coupons).toHaveLength(3);
      const codes = new Set(result.data.coupons.map((c) => c.code));
      expect(codes.size).toBe(3);

      // Buyer is the team admin.
      const membership = testDb
        .select()
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.userId, base.user.id))
        .get();
      expect(membership?.role).toBe(schema.TeamMemberRole.Admin);

      // Buyer is NOT enrolled.
      const enrollment = testDb
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.userId, base.user.id))
        .get();
      expect(enrollment).toBeUndefined();
    });

    it("multiplies the unit price by quantity", () => {
      const result = buyForTeam({
        userId: base.user.id,
        course: {
          id: base.course.id,
          price: 10000,
          pppEnabled: false,
          instructorId: base.instructor.id,
        },
        country: "US",
        quantity: 4,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.purchase.pricePaid).toBe(40000);
    });

    it("reuses the same team across multiple team purchases", () => {
      const first = buyForTeam({
        userId: base.user.id,
        course: course(),
        country: "US",
        quantity: 2,
      });

      const course2 = testDb
        .insert(schema.courses)
        .values({
          title: "Second Course",
          slug: "second-course",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const second = buyForTeam({
        userId: base.user.id,
        course: {
          id: course2.id,
          price: 0,
          pppEnabled: true,
          instructorId: base.instructor.id,
        },
        country: "US",
        quantity: 3,
      });

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.data.team.id).toBe(first.data.team.id);
    });

    it("rejects the instructor buying seats for their own course", () => {
      const result = buyForTeam({
        userId: base.instructor.id,
        course: course(),
        country: "US",
        quantity: 2,
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toBe("You can't purchase your own course");
    });

    it("rolls back the whole purchase if a coupon write fails", () => {
      // Force a failure mid-transaction by making the coupons insert throw on
      // the 2nd row via a unique-constraint clash is hard to arrange; instead
      // pass an invalid courseId so generateCoupons' FK insert throws.
      const badCourseId = 999999;
      expect(() =>
        buyForTeam({
          userId: base.user.id,
          course: {
            id: badCourseId,
            price: 0,
            pppEnabled: true,
            instructorId: base.instructor.id,
          },
          country: "US",
          quantity: 3,
        })
      ).toThrow();

      // Nothing committed: no purchase rows for the bad course.
      const purchases = testDb
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.courseId, badCourseId))
        .all();
      expect(purchases).toHaveLength(0);
      const coupons = testDb
        .select()
        .from(schema.coupons)
        .where(eq(schema.coupons.courseId, badCourseId))
        .all();
      expect(coupons).toHaveLength(0);
    });
  });

  describe("redeem", () => {
    function seedTeamCoupon(opts: {
      country: string | null;
      quantity?: number;
    }) {
      const buy = buyForTeam({
        userId: base.user.id,
        course: course(),
        country: opts.country,
        quantity: opts.quantity ?? 1,
      });
      if (!buy.ok) throw new Error("setup failed");
      return buy.data;
    }

    it("redeems a valid coupon and enrolls the user", () => {
      const { coupons } = seedTeamCoupon({ country: "US" });
      const redeemer = createUser("Redeemer", "redeemer@example.com");

      const result = redeem({
        code: coupons[0].code,
        userId: redeemer.id,
        country: "US",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.enrollment.userId).toBe(redeemer.id);

      const updated = getCouponByCode(coupons[0].code);
      expect(updated!.redeemedByUserId).toBe(redeemer.id);
      expect(updated!.redeemedAt).toBeDefined();
    });

    it("rejects a nonexistent code", () => {
      const result = redeem({ code: "nope", userId: 999, country: "US" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Coupon not found");
    });

    it("rejects an already-consumed coupon", () => {
      const { coupons } = seedTeamCoupon({ country: "US" });
      const a = createUser("A", "a@example.com");
      const b = createUser("B", "b@example.com");

      redeem({ code: coupons[0].code, userId: a.id, country: "US" });
      const result = redeem({
        code: coupons[0].code,
        userId: b.id,
        country: "US",
      });

      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toBe("Coupon has already been redeemed");
    });

    it("rejects when the user is already enrolled (coupon stays unconsumed)", () => {
      const { coupons } = seedTeamCoupon({ country: "US" });
      const redeemer = createUser("Redeemer", "redeemer@example.com");
      testDb
        .insert(schema.enrollments)
        .values({ userId: redeemer.id, courseId: base.course.id })
        .run();

      const result = redeem({
        code: coupons[0].code,
        userId: redeemer.id,
        country: "US",
      });
      expect(result.ok).toBe(false);

      const unchanged = getCouponByCode(coupons[0].code);
      expect(unchanged!.redeemedByUserId).toBeNull();
    });

    it("rejects redemption from a different country", () => {
      const { coupons } = seedTeamCoupon({ country: "US" });
      const redeemer = createUser("Redeemer", "redeemer@example.com");

      const result = redeem({
        code: coupons[0].code,
        userId: redeemer.id,
        country: "PL",
      });
      expect(result.ok).toBe(false);

      const unchanged = getCouponByCode(coupons[0].code);
      expect(unchanged!.redeemedByUserId).toBeNull();
    });

    it("allows redemption when the purchase has no country", () => {
      const { coupons } = seedTeamCoupon({ country: null });
      const redeemer = createUser("Redeemer", "redeemer@example.com");

      const result = redeem({
        code: coupons[0].code,
        userId: redeemer.id,
        country: "PL",
      });
      expect(result.ok).toBe(true);
    });

    it("notifies team admins with per-course seat counts after commit", () => {
      const { coupons } = seedTeamCoupon({ country: "US", quantity: 3 });
      const redeemer = createUser("Redeemer", "redeemer@example.com");

      redeem({ code: coupons[0].code, userId: redeemer.id, country: "US" });

      const notifications = getNotifications(base.user.id, 10, 0);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(
        schema.NotificationType.CouponRedemption
      );
      expect(notifications[0].title).toBe("Seat Claimed");
      expect(notifications[0].message).toBe(
        "Redeemer redeemed a coupon for Test Course (2 of 3 seats remaining)"
      );
    });

    it("does not notify when redemption fails", () => {
      const { coupons } = seedTeamCoupon({ country: "US" });
      const redeemer = createUser("Redeemer", "redeemer@example.com");

      const result = redeem({
        code: coupons[0].code,
        userId: redeemer.id,
        country: "PL",
      });
      expect(result.ok).toBe(false);
      expect(getNotifications(base.user.id, 10, 0)).toHaveLength(0);
    });
  });

  describe("promo codes", () => {
    it("buyForSelf applies a valid promo and records its redemption", () => {
      const c = paidCourse(10000);
      createPromo({
        code: "SAVE25",
        discountType: schema.PromoDiscountType.Percent,
        discountValue: 25,
      });

      const result = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
        promoCode: "save25",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.purchase.pricePaid).toBe(7500);
      expect(getPromoByCode("SAVE25")?.redemptionCount).toBe(1);
    });

    it("buyForSelf fails (no purchase) when the promo is invalid", () => {
      const c = paidCourse(10000);
      const result = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
        promoCode: "GHOST",
      });
      expect(result.ok).toBe(false);

      const purchases = testDb.select().from(schema.purchases).all();
      expect(purchases).toHaveLength(0);
    });

    it("buyForTeam applies the promo per seat and counts one redemption", () => {
      const c = paidCourse(10000);
      createPromo({
        code: "TENOFF",
        discountType: schema.PromoDiscountType.Fixed,
        discountValue: 1000,
      });

      const result = buyForTeam({
        userId: base.user.id,
        course: c,
        country: null,
        quantity: 3,
        promoCode: "TENOFF",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // (10000 − 1000) × 3
      expect(result.data.purchase.pricePaid).toBe(27000);
      expect(getPromoByCode("TENOFF")?.redemptionCount).toBe(1);
    });
  });

  describe("isWithinRefundWindow", () => {
    it("is true inside the window and false past it", () => {
      const now = new Date("2026-06-30T00:00:00.000Z");
      const recent = new Date("2026-06-20T00:00:00.000Z").toISOString();
      const old = new Date("2026-05-01T00:00:00.000Z").toISOString();
      expect(isWithinRefundWindow(recent, now)).toBe(true);
      expect(isWithinRefundWindow(old, now)).toBe(false);
    });
  });

  describe("refund", () => {
    it("refunds a self purchase: marks it, unwinds enrollment, notifies", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      expect(buy.ok).toBe(true);
      if (!buy.ok) return;

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.team).toBe(false);

      const purchase = testDb
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.id, buy.data.purchase.id))
        .get();
      expect(purchase?.refundedAt).toBeTruthy();

      expect(
        findEnrollment({ userId: base.user.id, courseId: c.id })
      ).toBeUndefined();

      const notifications = getNotifications(base.instructor.id, 10, 0);
      expect(
        notifications.some((n) => n.type === schema.NotificationType.Refund)
      ).toBe(true);
    });

    it("rejects a non-owner without admin rights", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;
      const other = createUser("Other", "other@example.com");

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: other.id,
      });
      expect(result.ok).toBe(false);
    });

    it("enforces the refund window for students", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;
      // Backdate the purchase beyond the window.
      const old = new Date(
        Date.now() - (REFUND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000
      ).toISOString();
      testDb
        .update(schema.purchases)
        .set({ createdAt: old })
        .where(eq(schema.purchases.id, buy.data.purchase.id))
        .run();

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(result.ok).toBe(false);
    });

    it("admin override bypasses the window", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;
      const old = new Date(
        Date.now() - (REFUND_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000
      ).toISOString();
      testDb
        .update(schema.purchases)
        .set({ createdAt: old })
        .where(eq(schema.purchases.id, buy.data.purchase.id))
        .run();

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.instructor.id,
        isAdmin: true,
      });
      expect(result.ok).toBe(true);
    });

    it("rejects an already-refunded purchase", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;

      refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      const second = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(second.ok).toBe(false);
      if (!second.ok)
        expect(second.error).toBe("This purchase has already been refunded");
    });

    it("rejects a missing purchase", () => {
      const result = refund({ purchaseId: 999999, requestedByUserId: 1 });
      expect(result.ok).toBe(false);
    });

    it("blocks a self refund once more than the watched-lesson limit", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;
      watchLessons({
        userId: base.user.id,
        courseId: c.id,
        count: MAX_REFUND_WATCHED_LESSONS + 1,
      });

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(result.ok).toBe(false);

      // Not refunded.
      const purchase = testDb
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.id, buy.data.purchase.id))
        .get();
      expect(purchase?.refundedAt).toBeNull();
    });

    it("allows a self refund at exactly the watched-lesson limit", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;
      watchLessons({
        userId: base.user.id,
        courseId: c.id,
        count: MAX_REFUND_WATCHED_LESSONS,
      });

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(result.ok).toBe(true);
    });

    it("admin override bypasses the watched-lesson limit", () => {
      const c = paidCourse(10000);
      const buy = buyForSelf({
        userId: base.user.id,
        course: c,
        country: null,
      });
      if (!buy.ok) return;
      watchLessons({
        userId: base.user.id,
        courseId: c.id,
        count: MAX_REFUND_WATCHED_LESSONS + 5,
      });

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.instructor.id,
        isAdmin: true,
      });
      expect(result.ok).toBe(true);
    });

    it("blocks a team self refund once more than 3 seat holders have watched", () => {
      const c = paidCourse(10000);
      const buy = buyForTeam({
        userId: base.user.id,
        course: c,
        country: null,
        quantity: 4,
      });
      if (!buy.ok) return;

      // 4 distinct redeemers each start watching a lesson in the course.
      for (let i = 0; i < 4; i++) {
        const u = createUser(`Member${i}`, `member${i}@example.com`);
        redeem({ code: buy.data.coupons[i].code, userId: u.id, country: null });
        watchLessons({ userId: u.id, courseId: c.id, count: 1 });
      }

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(result.ok).toBe(false);

      const purchase = testDb
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.id, buy.data.purchase.id))
        .get();
      expect(purchase?.refundedAt).toBeNull();
    });

    it("allows a team self refund when 3 or fewer seat holders have watched", () => {
      const c = paidCourse(10000);
      const buy = buyForTeam({
        userId: base.user.id,
        course: c,
        country: null,
        quantity: 4,
      });
      if (!buy.ok) return;

      // 3 redeemers watch; a 4th redeems but never watches.
      for (let i = 0; i < 3; i++) {
        const u = createUser(`Member${i}`, `member${i}@example.com`);
        redeem({ code: buy.data.coupons[i].code, userId: u.id, country: null });
        watchLessons({ userId: u.id, courseId: c.id, count: 2 });
      }
      const idle = createUser("Idle", "idle@example.com");
      redeem({
        code: buy.data.coupons[3].code,
        userId: idle.id,
        country: null,
      });

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
      });
      expect(result.ok).toBe(true);
    });

    it("refunds a team purchase: revokes coupons + redeemer enrollments", () => {
      const c = paidCourse(10000);
      const buy = buyForTeam({
        userId: base.user.id,
        course: c,
        country: null,
        quantity: 3,
      });
      if (!buy.ok) return;

      const redeemer = createUser("Redeemer", "redeemer@example.com");
      redeem({
        code: buy.data.coupons[0].code,
        userId: redeemer.id,
        country: null,
      });
      expect(
        findEnrollment({ userId: redeemer.id, courseId: c.id })
      ).toBeDefined();

      const result = refund({
        purchaseId: buy.data.purchase.id,
        requestedByUserId: base.user.id,
        isAdmin: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.team).toBe(true);
      expect(result.data.couponsRevoked).toBe(3);

      // Redeemer's enrollment is gone and no coupons remain for the purchase.
      expect(
        findEnrollment({ userId: redeemer.id, courseId: c.id })
      ).toBeUndefined();
      const remaining = testDb
        .select()
        .from(schema.coupons)
        .where(eq(schema.coupons.purchaseId, buy.data.purchase.id))
        .all();
      expect(remaining).toHaveLength(0);
    });
  });
});
