import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { PromoDiscountType } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  createPromo,
  getPromoByCode,
  validatePromo,
  computeDiscountedPrice,
  incrementPromoRedemption,
  setPromoActive,
  deletePromo,
  listPromos,
} from "./promoService";

function make(opts: Partial<Parameters<typeof createPromo>[0]> = {}) {
  const result = createPromo({
    code: opts.code ?? "SAVE",
    discountType: opts.discountType ?? PromoDiscountType.Percent,
    discountValue: opts.discountValue ?? 25,
    maxRedemptions: opts.maxRedemptions ?? null,
    expiresAt: opts.expiresAt ?? null,
  });
  if (!result.ok) throw new Error(result.error);
  return result.promo;
}

describe("promoService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    seedBaseData(testDb);
  });

  describe("createPromo", () => {
    it("normalizes the code to uppercase and rejects duplicates", () => {
      const p = make({ code: "  summer25 " });
      expect(p.code).toBe("SUMMER25");
      expect(getPromoByCode("summer25")?.id).toBe(p.id);

      const dup = createPromo({
        code: "SUMMER25",
        discountType: PromoDiscountType.Percent,
        discountValue: 10,
      });
      expect(dup.ok).toBe(false);
    });

    it("validates discount bounds", () => {
      expect(
        createPromo({
          code: "A",
          discountType: PromoDiscountType.Percent,
          discountValue: 150,
        }).ok
      ).toBe(false);
      expect(
        createPromo({
          code: "B",
          discountType: PromoDiscountType.Fixed,
          discountValue: 0,
        }).ok
      ).toBe(false);
    });
  });

  describe("computeDiscountedPrice", () => {
    it("applies percent and fixed discounts, clamped at 0", () => {
      const pct = make({ code: "P", discountValue: 25 });
      expect(computeDiscountedPrice(10000, pct)).toBe(7500);

      const fixed = make({
        code: "F",
        discountType: PromoDiscountType.Fixed,
        discountValue: 3000,
      });
      expect(computeDiscountedPrice(10000, fixed)).toBe(7000);
      expect(computeDiscountedPrice(2000, fixed)).toBe(0); // clamped
    });
  });

  describe("validatePromo", () => {
    it("accepts an active, unexpired, under-limit code", () => {
      make({ code: "OK" });
      expect(validatePromo({ code: "ok" }).ok).toBe(true);
    });

    it("rejects unknown, inactive, expired, and exhausted codes", () => {
      expect(validatePromo({ code: "NOPE" }).ok).toBe(false);

      const inactive = make({ code: "OFF" });
      setPromoActive({ id: inactive.id, active: false });
      expect(validatePromo({ code: "OFF" }).ok).toBe(false);

      make({ code: "OLD", expiresAt: "2020-01-01T00:00:00.000Z" });
      expect(validatePromo({ code: "OLD" }).ok).toBe(false);

      const limited = make({ code: "ONE", maxRedemptions: 1 });
      incrementPromoRedemption(limited.id);
      expect(validatePromo({ code: "ONE" }).ok).toBe(false);
    });

    it("honors an injected now for expiry", () => {
      make({ code: "FUTURE", expiresAt: "2030-01-01T00:00:00.000Z" });
      expect(
        validatePromo({ code: "FUTURE", now: new Date("2031-01-01") }).ok
      ).toBe(false);
      expect(
        validatePromo({ code: "FUTURE", now: new Date("2029-01-01") }).ok
      ).toBe(true);
    });
  });

  describe("admin lifecycle", () => {
    it("lists, toggles, and deletes", () => {
      const p = make({ code: "X" });
      expect(listPromos().map((x) => x.code)).toContain("X");

      setPromoActive({ id: p.id, active: false });
      expect(getPromoByCode("X")?.active).toBe(false);

      deletePromo(p.id);
      expect(getPromoByCode("X")).toBeUndefined();
    });
  });
});
