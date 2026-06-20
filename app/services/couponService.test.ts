import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  generateCoupons,
  getCouponByCode,
  getCouponsForTeam,
} from "./couponService";

// Helper: create a team with admin and a purchase for coupon generation
function setupTeamAndPurchase(country: string | null = "US") {
  const team = testDb.insert(schema.teams).values({}).returning().get();

  testDb
    .insert(schema.teamMembers)
    .values({
      teamId: team.id,
      userId: base.user.id,
      role: schema.TeamMemberRole.Admin,
    })
    .run();

  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      pricePaid: 10000,
      country,
    })
    .returning()
    .get();

  return { team, purchase };
}

describe("couponService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("generateCoupons", () => {
    it("generates the requested number of coupons", () => {
      const { team, purchase } = setupTeamAndPurchase();

      const result = generateCoupons({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        quantity: 5,
      });

      expect(result).toHaveLength(5);
    });

    it("generates unique codes for each coupon", () => {
      const { team, purchase } = setupTeamAndPurchase();

      const result = generateCoupons({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        quantity: 10,
      });
      const codes = result.map((c) => c.code);
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(10);
    });

    it("associates coupons with the correct team, course, and purchase", () => {
      const { team, purchase } = setupTeamAndPurchase();

      const result = generateCoupons({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        quantity: 1,
      });

      expect(result[0].teamId).toBe(team.id);
      expect(result[0].courseId).toBe(base.course.id);
      expect(result[0].purchaseId).toBe(purchase.id);
      expect(result[0].redeemedByUserId).toBeNull();
      expect(result[0].redeemedAt).toBeNull();
    });
  });

  describe("getCouponByCode", () => {
    it("returns a coupon by its code", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        quantity: 1,
      });

      const found = getCouponByCode(coupon.code);

      expect(found).toBeDefined();
      expect(found!.id).toBe(coupon.id);
    });

    it("returns undefined for a nonexistent code", () => {
      const found = getCouponByCode("nonexistent-code");

      expect(found).toBeUndefined();
    });
  });

  describe("getCouponsForTeam", () => {
    it("returns all coupons for a team", () => {
      const { team, purchase } = setupTeamAndPurchase();
      generateCoupons({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        quantity: 3,
      });

      const result = getCouponsForTeam({ teamId: team.id });

      expect(result).toHaveLength(3);
    });

    it("filters coupons by course when courseId is provided", () => {
      const { team, purchase } = setupTeamAndPurchase();

      // Create a second course
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

      const purchase2 = testDb
        .insert(schema.purchases)
        .values({
          userId: base.user.id,
          courseId: course2.id,
          pricePaid: 5000,
          country: "US",
        })
        .returning()
        .get();

      generateCoupons({
        teamId: team.id,
        courseId: base.course.id,
        purchaseId: purchase.id,
        quantity: 3,
      });
      generateCoupons({
        teamId: team.id,
        courseId: course2.id,
        purchaseId: purchase2.id,
        quantity: 2,
      });

      const filtered = getCouponsForTeam({
        teamId: team.id,
        courseId: base.course.id,
      });
      expect(filtered).toHaveLength(3);

      const filtered2 = getCouponsForTeam({
        teamId: team.id,
        courseId: course2.id,
      });
      expect(filtered2).toHaveLength(2);

      const all = getCouponsForTeam({ teamId: team.id });
      expect(all).toHaveLength(5);
    });
  });
});
