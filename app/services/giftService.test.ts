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

import {
  generateGiftCode,
  createGift,
  getGiftByCode,
  getGiftsBySender,
} from "./giftService";

function makePurchase() {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      pricePaid: 1000,
      country: null,
    })
    .returning()
    .get();
}

describe("giftService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("generates unique-ish codes", () => {
    const a = generateGiftCode();
    const b = generateGiftCode();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("creates and looks up a gift by code", () => {
    const purchase = makePurchase();
    const gift = createGift({
      purchaseId: purchase.id,
      courseId: base.course.id,
      senderId: base.user.id,
      recipientEmail: "friend@example.com",
      message: "Enjoy!",
      code: "GIFTCODE1",
    });
    expect(gift.claimedAt).toBeNull();

    const found = getGiftByCode("GIFTCODE1");
    expect(found?.id).toBe(gift.id);
    expect(found?.recipientEmail).toBe("friend@example.com");
    expect(getGiftByCode("nope")).toBeUndefined();
  });

  it("lists a sender's gifts newest first with course details", () => {
    const p1 = makePurchase();
    const p2 = makePurchase();
    createGift({
      purchaseId: p1.id,
      courseId: base.course.id,
      senderId: base.user.id,
      recipientEmail: "a@example.com",
      message: null,
      code: "G1",
    });
    createGift({
      purchaseId: p2.id,
      courseId: base.course.id,
      senderId: base.user.id,
      recipientEmail: "b@example.com",
      message: null,
      code: "G2",
    });

    const list = getGiftsBySender(base.user.id);
    expect(list).toHaveLength(2);
    expect(list[0].code).toBe("G2"); // newest first
    expect(list[0].courseTitle).toBe(base.course.title);
    // Unclaimed gift → no claimer name.
    expect(list[0].claimedByName).toBeNull();
  });

  it("scopes the list to the sender", () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    const purchase = makePurchase();
    createGift({
      purchaseId: purchase.id,
      courseId: base.course.id,
      senderId: base.user.id,
      recipientEmail: "x@example.com",
      message: null,
      code: "ONLYMINE",
    });

    expect(getGiftsBySender(other.id)).toHaveLength(0);
    expect(getGiftsBySender(base.user.id)).toHaveLength(1);
  });
});
