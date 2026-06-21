import { eq, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import { promoCodes, PromoDiscountType } from "~/db/schema";

// ─── Promo Service ───
// Marketing promo codes: a global checkout discount, distinct from team seat
// `coupons`. Owns validation, the (pure) discount math, the usage counter, and
// admin CRUD. The transaction service applies a validated promo as a pricing
// strategy and increments the counter inside the purchase transaction.
// Functions with multiple same-typed params take a single object param.

export type Promo = typeof promoCodes.$inferSelect;

export type PromoResult =
  | { ok: true; promo: Promo }
  | { ok: false; error: string };

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function getPromoByCode(code: string): Promo | undefined {
  return db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.code, normalizeCode(code)))
    .get();
}

export function listPromos(): Promo[] {
  return db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).all();
}

// Validates a code for use at checkout: exists, active, not expired, and under
// its redemption limit. `now` is injectable for deterministic tests.
export function validatePromo(opts: { code: string; now?: Date }): PromoResult {
  const promo = getPromoByCode(opts.code);
  if (!promo) {
    return { ok: false, error: "Promo code not found" };
  }
  if (!promo.active) {
    return { ok: false, error: "This promo code is no longer active" };
  }
  const now = opts.now ?? new Date();
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < now.getTime()) {
    return { ok: false, error: "This promo code has expired" };
  }
  if (
    promo.maxRedemptions !== null &&
    promo.redemptionCount >= promo.maxRedemptions
  ) {
    return { ok: false, error: "This promo code has reached its usage limit" };
  }
  return { ok: true, promo };
}

// Pure discount math. Percent: take `value`% off; Fixed: subtract `value` cents.
// Never returns below 0.
export function computeDiscountedPrice(
  basePrice: number,
  promo: Promo
): number {
  if (promo.discountType === PromoDiscountType.Percent) {
    const discounted = Math.round(basePrice * (1 - promo.discountValue / 100));
    return Math.max(0, discounted);
  }
  return Math.max(0, basePrice - promo.discountValue);
}

// Increments the usage counter (called inside the purchase transaction).
export function incrementPromoRedemption(promoId: number): void {
  db.update(promoCodes)
    .set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1` })
    .where(eq(promoCodes.id, promoId))
    .run();
}

// ─── Admin CRUD ───

export function createPromo(opts: {
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}): PromoResult {
  const code = normalizeCode(opts.code);
  if (!code) {
    return { ok: false, error: "Code is required" };
  }
  if (opts.discountType === PromoDiscountType.Percent) {
    if (opts.discountValue < 1 || opts.discountValue > 100) {
      return { ok: false, error: "Percent discount must be between 1 and 100" };
    }
  } else if (opts.discountValue < 1) {
    return { ok: false, error: "Fixed discount must be greater than 0" };
  }
  if (getPromoByCode(code)) {
    return { ok: false, error: "A promo code with that code already exists" };
  }

  const promo = db
    .insert(promoCodes)
    .values({
      code,
      discountType: opts.discountType,
      discountValue: opts.discountValue,
      maxRedemptions: opts.maxRedemptions ?? null,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning()
    .get();
  return { ok: true, promo };
}

export function setPromoActive(opts: { id: number; active: boolean }): void {
  db.update(promoCodes)
    .set({ active: opts.active })
    .where(eq(promoCodes.id, opts.id))
    .run();
}

export function deletePromo(id: number): void {
  db.delete(promoCodes).where(eq(promoCodes.id, id)).run();
}
