import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "~/db";
import { notifications, NotificationType } from "~/db/schema";
import {
  enqueueEmail,
  composeEmailBody,
  scheduleEmailDispatch,
} from "./emailService";

// ─── Notification Service ───
// In-app notifications delivered to a recipient user. Generic by design
// (type/title/message/linkUrl). Every notification is also mirrored to the email
// outbox (delivered later by the dispatcher), so producers get both channels
// from one call. Functions use positional params (each differs in type / read
// intent).

export function createNotification(
  recipientUserId: number,
  type: NotificationType,
  title: string,
  message: string,
  linkUrl: string
) {
  const notification = db
    .insert(notifications)
    .values({ recipientUserId, type, title, message, linkUrl })
    .returning()
    .get();

  // Mirror to email (queued; delivered by the dispatcher). Best-effort: a
  // missing recipient email simply queues nothing.
  enqueueEmail({
    recipientUserId,
    subject: title,
    body: composeEmailBody(message, linkUrl),
  });
  // Kick off automatic delivery in the background (no-op under tests).
  scheduleEmailDispatch();

  return notification;
}

export function getNotifications(
  userId: number,
  limit: number,
  offset: number
) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .offset(offset)
    .all();
}

export function getNotificationById(id: number) {
  return db.select().from(notifications).where(eq(notifications.id, id)).get();
}

export function getUnreadCount(userId: number) {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.isRead, false)
      )
    )
    .get();

  return result?.count ?? 0;
}

export function markAsRead(notificationId: number) {
  return db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, notificationId))
    .returning()
    .get();
}

export function markAllAsRead(userId: number) {
  return db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.recipientUserId, userId))
    .run();
}
