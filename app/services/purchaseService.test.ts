import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  createPurchase,
  getPurchaseById,
  findPurchase,
  getPurchasesByUser,
  getPurchasesByCourse,
} from "./purchaseService";

describe("purchaseService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  // ─── Create Purchase ───

  describe("createPurchase", () => {
    it("creates a purchase record", () => {
      const purchase = createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: "US",
      });
      expect(purchase).toBeDefined();
      expect(purchase.userId).toBe(base.user.id);
      expect(purchase.courseId).toBe(base.course.id);
      expect(purchase.pricePaid).toBe(4999);
      expect(purchase.country).toBe("US");
    });

    it("creates a purchase with null country", () => {
      const purchase = createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: null,
      });
      expect(purchase.country).toBeNull();
    });

    it("stores discounted price correctly", () => {
      const purchase = createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 2500,
        country: "IN",
      });
      expect(purchase.pricePaid).toBe(2500);
      expect(purchase.country).toBe("IN");
    });
  });

  // ─── Find Purchase ───

  describe("findPurchase", () => {
    it("returns purchase for user+course", () => {
      createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: "US",
      });
      const found = findPurchase({
        userId: base.user.id,
        courseId: base.course.id,
      });
      expect(found).toBeDefined();
      expect(found!.pricePaid).toBe(4999);
    });

    it("returns undefined when no purchase exists", () => {
      expect(
        findPurchase({ userId: base.user.id, courseId: base.course.id })
      ).toBeUndefined();
    });
  });

  // ─── Get By User ───

  describe("getPurchasesByUser", () => {
    it("returns all purchases for a user", () => {
      createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: "US",
      });
      const purchases = getPurchasesByUser(base.user.id);
      expect(purchases).toHaveLength(1);
    });

    it("returns empty array when user has no purchases", () => {
      expect(getPurchasesByUser(base.user.id)).toHaveLength(0);
    });
  });

  // ─── Get By Course ───

  describe("getPurchasesByCourse", () => {
    it("returns all purchases for a course", () => {
      createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: "US",
      });
      createPurchase({
        userId: base.instructor.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: "GB",
      });
      const purchases = getPurchasesByCourse(base.course.id);
      expect(purchases).toHaveLength(2);
    });
  });

  // ─── Get By Id ───

  describe("getPurchaseById", () => {
    it("returns the purchase by id", () => {
      const created = createPurchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 4999,
        country: "US",
      });
      const found = getPurchaseById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it("returns undefined for a nonexistent id", () => {
      expect(getPurchaseById(999)).toBeUndefined();
    });
  });
});
