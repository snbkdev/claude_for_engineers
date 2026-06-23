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
  register,
  login,
  requestPasswordReset,
  getValidResetToken,
  resetPassword,
} from "./authService";

describe("authService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("register", () => {
    it("creates a student with a hashed password", async () => {
      const result = await register({
        name: "New Learner",
        email: "New@Example.com",
        password: "supersecret",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.user.email).toBe("new@example.com");
      expect(result.user.role).toBe(schema.UserRole.Student);
      expect(result.user.passwordHash).toBeTruthy();
      expect(result.user.passwordHash).not.toBe("supersecret");
    });

    it("rejects a duplicate email", async () => {
      const r = await register({
        name: "Dupe",
        email: "test@example.com", // seeded student
        password: "supersecret",
      });
      expect(r.ok).toBe(false);
    });

    it("rejects a too-short password", async () => {
      const r = await register({
        name: "Shorty",
        email: "shorty@example.com",
        password: "short",
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("login", () => {
    beforeEach(async () => {
      await register({
        name: "Member",
        email: "member@example.com",
        password: "supersecret",
      });
    });

    it("succeeds with correct credentials", async () => {
      const r = await login({
        email: "member@example.com",
        password: "supersecret",
      });
      expect(r.ok).toBe(true);
    });

    it("fails with a wrong password", async () => {
      const r = await login({
        email: "member@example.com",
        password: "wrongpass",
      });
      expect(r.ok).toBe(false);
    });

    it("fails for an account with no password (legacy/DevUI user)", async () => {
      const r = await login({
        email: "test@example.com", // seeded, no passwordHash
        password: "anything",
      });
      expect(r.ok).toBe(false);
    });

    it("fails for an unknown email", async () => {
      const r = await login({ email: "nobody@example.com", password: "x" });
      expect(r.ok).toBe(false);
    });
  });

  describe("password reset", () => {
    beforeEach(async () => {
      await register({
        name: "Member",
        email: "member@example.com",
        password: "originalpass",
      });
    });

    it("creates a valid token for an existing email", async () => {
      const res = await requestPasswordReset("member@example.com");
      expect(res).not.toBeNull();
      expect(getValidResetToken(res!.token)).toBeTruthy();
    });

    it("returns null for an unknown email (no token created)", async () => {
      const res = await requestPasswordReset("ghost@example.com");
      expect(res).toBeNull();
    });

    it("treats an expired token as invalid", async () => {
      const res = await requestPasswordReset("member@example.com");
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h
      expect(getValidResetToken(res!.token, future)).toBeUndefined();
    });

    it("resets the password and is single-use", async () => {
      const res = await requestPasswordReset("member@example.com");

      const done = await resetPassword({
        token: res!.token,
        password: "brandnewpass",
      });
      expect(done.ok).toBe(true);

      // New password works, old one doesn't.
      expect(
        (await login({ email: "member@example.com", password: "brandnewpass" }))
          .ok
      ).toBe(true);
      expect(
        (await login({ email: "member@example.com", password: "originalpass" }))
          .ok
      ).toBe(false);

      // Token can't be reused.
      const reuse = await resetPassword({
        token: res!.token,
        password: "anotherpass",
      });
      expect(reuse.ok).toBe(false);
    });

    it("rejects resetting with an unknown token", async () => {
      const r = await resetPassword({ token: "bogus", password: "longenough" });
      expect(r.ok).toBe(false);
    });

    it("marks the token used in the DB after a reset", async () => {
      const res = await requestPasswordReset("member@example.com");
      await resetPassword({ token: res!.token, password: "brandnewpass" });

      const rows = testDb
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, res!.userId))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0].usedAt).not.toBeNull();
    });
  });
});
