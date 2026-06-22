import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationType } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  createNotification,
  getNotifications,
  getNotificationById,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "./notificationService";

function makeUser(name: string, email: string) {
  return testDb
    .insert(schema.users)
    .values({ name, email, role: schema.UserRole.Instructor })
    .returning()
    .get();
}

describe("notificationService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("createNotification", () => {
    it("creates a notification with all fields", () => {
      const n = createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "New Enrollment",
        "Test User enrolled in Test Course",
        "/instructor/1/students"
      );

      expect(n).toBeDefined();
      expect(n.recipientUserId).toBe(base.instructor.id);
      expect(n.type).toBe(NotificationType.Enrollment);
      expect(n.title).toBe("New Enrollment");
      expect(n.message).toBe("Test User enrolled in Test Course");
      expect(n.linkUrl).toBe("/instructor/1/students");
      expect(n.isRead).toBe(false);
      expect(n.createdAt).toBeDefined();
    });

    it("mirrors the notification to the email outbox", () => {
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "New Enrollment",
        "Test User enrolled in Test Course",
        "/instructor/1/students"
      );

      const queued = testDb
        .select()
        .from(schema.emailOutbox)
        .where(eq(schema.emailOutbox.recipientUserId, base.instructor.id))
        .all();
      expect(queued).toHaveLength(1);
      expect(queued[0].toEmail).toBe(base.instructor.email);
      expect(queued[0].subject).toBe("New Enrollment");
      expect(queued[0].status).toBe(schema.EmailStatus.Pending);
    });
  });

  describe("getNotifications", () => {
    it("returns notifications newest first", () => {
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "First",
        "m1",
        "/a"
      );
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "Second",
        "m2",
        "/b"
      );
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "Third",
        "m3",
        "/c"
      );

      const list = getNotifications(base.instructor.id, 10, 0);
      expect(list).toHaveLength(3);
      expect(list[0].title).toBe("Third");
      expect(list[2].title).toBe("First");
    });

    it("respects limit and offset", () => {
      for (let i = 1; i <= 5; i++) {
        createNotification(
          base.instructor.id,
          NotificationType.Enrollment,
          `N${i}`,
          "m",
          "/x"
        );
      }

      const firstPage = getNotifications(base.instructor.id, 2, 0);
      expect(firstPage).toHaveLength(2);
      expect(firstPage[0].title).toBe("N5");
      expect(firstPage[1].title).toBe("N4");

      const secondPage = getNotifications(base.instructor.id, 2, 2);
      expect(secondPage).toHaveLength(2);
      expect(secondPage[0].title).toBe("N3");
      expect(secondPage[1].title).toBe("N2");
    });

    it("only returns the requesting user's notifications", () => {
      const other = makeUser("Other Instructor", "other@example.com");
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "Mine",
        "m",
        "/x"
      );
      createNotification(
        other.id,
        NotificationType.Enrollment,
        "Theirs",
        "m",
        "/x"
      );

      const mine = getNotifications(base.instructor.id, 10, 0);
      expect(mine).toHaveLength(1);
      expect(mine[0].title).toBe("Mine");
    });

    it("returns an empty array when there are none", () => {
      expect(getNotifications(base.instructor.id, 10, 0)).toHaveLength(0);
    });
  });

  describe("getUnreadCount", () => {
    it("counts only unread notifications for the user", () => {
      const a = createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "A",
        "m",
        "/x"
      );
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "B",
        "m",
        "/x"
      );
      const other = makeUser("Other", "other2@example.com");
      createNotification(other.id, NotificationType.Enrollment, "C", "m", "/x");

      expect(getUnreadCount(base.instructor.id)).toBe(2);

      markAsRead(a.id);
      expect(getUnreadCount(base.instructor.id)).toBe(1);
    });

    it("returns 0 when the user has no notifications", () => {
      expect(getUnreadCount(base.instructor.id)).toBe(0);
    });
  });

  describe("markAsRead", () => {
    it("marks a single notification as read", () => {
      const n = createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "A",
        "m",
        "/x"
      );

      const updated = markAsRead(n.id);
      expect(updated!.isRead).toBe(true);
      expect(getNotificationById(n.id)!.isRead).toBe(true);
    });
  });

  describe("markAllAsRead", () => {
    it("marks all of a user's notifications as read without touching others", () => {
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "A",
        "m",
        "/x"
      );
      createNotification(
        base.instructor.id,
        NotificationType.Enrollment,
        "B",
        "m",
        "/x"
      );
      const other = makeUser("Other", "other3@example.com");
      const theirs = createNotification(
        other.id,
        NotificationType.Enrollment,
        "C",
        "m",
        "/x"
      );

      markAllAsRead(base.instructor.id);

      expect(getUnreadCount(base.instructor.id)).toBe(0);
      // The other user's notification is untouched.
      expect(getNotificationById(theirs.id)!.isRead).toBe(false);
    });
  });
});
