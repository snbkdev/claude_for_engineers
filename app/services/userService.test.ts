import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "~/test/setup";
import { UserRole } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getAllUsers,
  getUserById,
  getUserByEmail,
  getUsersByRole,
  createUser,
  updateUser,
  updateUserRole,
} from "./userService";

describe("userService", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  describe("createUser", () => {
    it("creates a user with the given fields", () => {
      const user = createUser({ name: "Ada Lovelace", email: "ada@example.com", role: UserRole.Student, avatarUrl: null });

      expect(user.id).toBeDefined();
      expect(user.name).toBe("Ada Lovelace");
      expect(user.email).toBe("ada@example.com");
      expect(user.role).toBe(UserRole.Student);
      expect(user.avatarUrl).toBeNull();
    });

    it("rejects a duplicate email (unique constraint)", () => {
      createUser({ name: "First", email: "dup@example.com", role: UserRole.Student, avatarUrl: null });
      expect(() =>
        createUser({ name: "Second", email: "dup@example.com", role: UserRole.Student, avatarUrl: null })
      ).toThrow();
    });
  });

  describe("lookups", () => {
    it("finds a user by id and by email", () => {
      const created = createUser({ name: "Grace Hopper", email: "grace@example.com", role: UserRole.Instructor, avatarUrl: "https://img/grace.png" });

      expect(getUserById(created.id)?.email).toBe("grace@example.com");
      expect(getUserByEmail("grace@example.com")?.id).toBe(created.id);
    });

    it("returns undefined for a missing user", () => {
      expect(getUserById(999)).toBeUndefined();
      expect(getUserByEmail("nobody@example.com")).toBeUndefined();
    });

    it("getAllUsers returns every user", () => {
      createUser({ name: "A", email: "a@example.com", role: UserRole.Student, avatarUrl: null });
      createUser({ name: "B", email: "b@example.com", role: UserRole.Admin, avatarUrl: null });
      expect(getAllUsers()).toHaveLength(2);
    });

    it("getUsersByRole filters by role", () => {
      createUser({ name: "S1", email: "s1@example.com", role: UserRole.Student, avatarUrl: null });
      createUser({ name: "S2", email: "s2@example.com", role: UserRole.Student, avatarUrl: null });
      createUser({ name: "I1", email: "i1@example.com", role: UserRole.Instructor, avatarUrl: null });

      expect(getUsersByRole(UserRole.Student)).toHaveLength(2);
      expect(getUsersByRole(UserRole.Instructor)).toHaveLength(1);
      expect(getUsersByRole(UserRole.Admin)).toHaveLength(0);
    });
  });

  describe("updates", () => {
    it("updateUser changes name, email and bio", () => {
      const user = createUser({ name: "Old", email: "old@example.com", role: UserRole.Student, avatarUrl: null });
      const updated = updateUser({ id: user.id, name: "New Name", email: "new@example.com", bio: "A short bio" });

      expect(updated.name).toBe("New Name");
      expect(updated.email).toBe("new@example.com");
      expect(updated.bio).toBe("A short bio");
    });

    it("updateUserRole promotes a user", () => {
      const user = createUser({ name: "Promote", email: "promote@example.com", role: UserRole.Student, avatarUrl: null });
      const updated = updateUserRole(user.id, UserRole.Admin);
      expect(updated.role).toBe(UserRole.Admin);
    });
  });
});
