import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { db } from "~/db";
import { gifts, courses, users } from "~/db/schema";

// ─── Gift Service ───
// Row primitives for course gifts. The purchase/enrollment orchestration
// (buyGift / claimGift) lives in transactionService; this module owns gift code
// generation, creation, and lookups/listing.
// Functions with multiple same-typed params take a single object param.

export function generateGiftCode(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function createGift(opts: {
  purchaseId: number;
  courseId: number;
  senderId: number;
  recipientEmail: string;
  message: string | null;
  code: string;
}) {
  return db
    .insert(gifts)
    .values({
      purchaseId: opts.purchaseId,
      courseId: opts.courseId,
      senderId: opts.senderId,
      recipientEmail: opts.recipientEmail,
      message: opts.message,
      code: opts.code,
    })
    .returning()
    .get();
}

export function getGiftByCode(code: string) {
  return db.select().from(gifts).where(eq(gifts.code, code)).get();
}

export function getGiftById(id: number) {
  return db.select().from(gifts).where(eq(gifts.id, id)).get();
}

// Gifts a user has sent, joined with course details + claimer name, newest
// first — for the "Gifts you've sent" page.
export function getGiftsBySender(senderId: number) {
  return db
    .select({
      id: gifts.id,
      code: gifts.code,
      courseId: gifts.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      recipientEmail: gifts.recipientEmail,
      message: gifts.message,
      claimedByUserId: gifts.claimedByUserId,
      claimedByName: users.name,
      claimedAt: gifts.claimedAt,
      createdAt: gifts.createdAt,
    })
    .from(gifts)
    .innerJoin(courses, eq(gifts.courseId, courses.id))
    .leftJoin(users, eq(gifts.claimedByUserId, users.id))
    .where(eq(gifts.senderId, senderId))
    .orderBy(desc(gifts.createdAt), desc(gifts.id))
    .all();
}
