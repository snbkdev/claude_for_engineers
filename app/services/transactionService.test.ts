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
  couponCountryMatches,
} from "./transactionService";
import { getCouponByCode } from "./couponService";
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
});
