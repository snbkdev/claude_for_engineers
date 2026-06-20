import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { coupons } from "~/db/schema";
import crypto from "crypto";

// ─── Coupon Service ───
// Handles coupon generation and listing. Each coupon grants one seat for a
// specific course within a team. Redemption orchestration (validation,
// enrollment, notifications) lives in transactionService.
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
