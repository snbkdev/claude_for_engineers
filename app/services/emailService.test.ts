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
  enqueueEmail,
  flushEmailOutbox,
  composeEmailBody,
  getDeliverableEmails,
  MAX_EMAIL_ATTEMPTS,
  type EmailAdapter,
  type EmailMessage,
} from "./emailService";

function okAdapter(sink: EmailMessage[]): EmailAdapter {
  return {
    name: "test-ok",
    async send(message) {
      sink.push(message);
    },
  };
}

function failAdapter(): EmailAdapter {
  return {
    name: "test-fail",
    async send() {
      throw new Error("boom");
    },
  };
}

describe("emailService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("enqueueEmail", () => {
    it("queues a pending row with the recipient's email", () => {
      const row = enqueueEmail({
        recipientUserId: base.user.id,
        subject: "Hi",
        body: "Body",
      });
      expect(row).not.toBeNull();
      expect(row?.toEmail).toBe(base.user.email);
      expect(row?.status).toBe(schema.EmailStatus.Pending);
    });

    it("queues nothing for an unknown user", () => {
      const row = enqueueEmail({
        recipientUserId: 999999,
        subject: "Hi",
        body: "Body",
      });
      expect(row).toBeNull();
      expect(getDeliverableEmails(10)).toHaveLength(0);
    });
  });

  describe("composeEmailBody", () => {
    it("includes the message and the link", () => {
      const body = composeEmailBody("You enrolled", "/dashboard");
      expect(body).toContain("You enrolled");
      expect(body).toContain("/dashboard");
    });
  });

  describe("flushEmailOutbox", () => {
    it("sends deliverable rows and marks them sent", async () => {
      enqueueEmail({
        recipientUserId: base.user.id,
        subject: "A",
        body: "a",
      });
      enqueueEmail({
        recipientUserId: base.instructor.id,
        subject: "B",
        body: "b",
      });

      const sink: EmailMessage[] = [];
      const result = await flushEmailOutbox({ adapter: okAdapter(sink) });

      expect(result).toEqual({ processed: 2, sent: 2, failed: 0 });
      expect(sink).toHaveLength(2);
      expect(getDeliverableEmails(10)).toHaveLength(0);

      const rows = testDb.select().from(schema.emailOutbox).all();
      expect(rows.every((r) => r.status === schema.EmailStatus.Sent)).toBe(
        true
      );
      expect(rows.every((r) => r.sentAt !== null)).toBe(true);
    });

    it("marks failed rows and records the error + attempt", async () => {
      const row = enqueueEmail({
        recipientUserId: base.user.id,
        subject: "A",
        body: "a",
      })!;

      const result = await flushEmailOutbox({ adapter: failAdapter() });
      expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });

      const updated = testDb
        .select()
        .from(schema.emailOutbox)
        .where(eq(schema.emailOutbox.id, row.id))
        .get();
      expect(updated?.status).toBe(schema.EmailStatus.Failed);
      expect(updated?.attempts).toBe(1);
      expect(updated?.error).toContain("boom");
    });

    it("retries a failed row until the attempt cap", async () => {
      enqueueEmail({ recipientUserId: base.user.id, subject: "A", body: "a" });

      // Fail it MAX times — each flush retries the still-deliverable row.
      for (let i = 0; i < MAX_EMAIL_ATTEMPTS; i++) {
        await flushEmailOutbox({ adapter: failAdapter() });
      }
      // Now at the cap: no longer deliverable, so a further flush is a no-op.
      expect(getDeliverableEmails(10)).toHaveLength(0);
      const result = await flushEmailOutbox({ adapter: failAdapter() });
      expect(result.processed).toBe(0);
    });

    it("does not re-send already-sent rows", async () => {
      enqueueEmail({ recipientUserId: base.user.id, subject: "A", body: "a" });
      await flushEmailOutbox({ adapter: okAdapter([]) });

      const sink: EmailMessage[] = [];
      const result = await flushEmailOutbox({ adapter: okAdapter(sink) });
      expect(result.processed).toBe(0);
      expect(sink).toHaveLength(0);
    });
  });
});
