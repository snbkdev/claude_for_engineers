import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { purchases } from "~/db/schema";

// ─── Purchase Service ───
// Handles purchase records (transaction log separate from enrollments).
// Functions with multiple same-typed params take a single object param.
// Purchase orchestration (individual + team, with enrollment / coupons /
// notifications) lives in transactionService; this module owns the purchase
// row primitives.

export function createPurchase(opts: {
  userId: number;
  courseId: number;
  pricePaid: number;
  country: string | null;
}) {
  return db
    .insert(purchases)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      pricePaid: opts.pricePaid,
      country: opts.country,
    })
    .returning()
    .get();
}

export function getPurchaseById(id: number) {
  return db.select().from(purchases).where(eq(purchases.id, id)).get();
}

export function findPurchase(opts: { userId: number; courseId: number }) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, opts.userId),
        eq(purchases.courseId, opts.courseId)
      )
    )
    .get();
}

export function getPurchasesByUser(userId: number) {
  return db.select().from(purchases).where(eq(purchases.userId, userId)).all();
}

export function getPurchasesByCourse(courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(eq(purchases.courseId, courseId))
    .all();
}
