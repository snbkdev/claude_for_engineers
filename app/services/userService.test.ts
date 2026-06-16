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
      const user = createUser(
        "Ada Lovelace",
        "ada@example.com",
        UserRole.Student,
        null
      );

      expect(user.id).toBeDefined();
      expect(user.name).toBe("Ada Lovelace");
      expect(user.email).toBe("ada@example.com");
      expect(user.role).toBe(UserRole.Student);
      expect(user.avatarUrl).toBeNull();
    });

    it("rejects a duplicate email (unique constraint)", () => {
      createUser("First", "dup@example.com", UserRole.Student, null);
      expect(() =>
        createUser("Second", "dup@example.com", UserRole.Student, null)
      ).toThrow();
    });
  });

  describe("lookups", () => {
    it("finds a user by id and by email", () => {
      const created = createUser(
        "Grace Hopper",
        "grace@example.com",
        UserRole.Instructor,
        "https://img/grace.png"
      );

      expect(getUserById(created.id)?.email).toBe("grace@example.com");
      expect(getUserByEmail("grace@example.com")?.id).toBe(created.id);
    });

    it("returns undefined for a missing user", () => {
      expect(getUserById(999)).toBeUndefined();
      expect(getUserByEmail("nobody@example.com")).toBeUndefined();
    });

    it("getAllUsers returns every user", () => {
      createUser("A", "a@example.com", UserRole.Student, null);
      createUser("B", "b@example.com", UserRole.Admin, null);
      expect(getAllUsers()).toHaveLength(2);
    });

    it("getUsersByRole filters by role", () => {
      createUser("S1", "s1@example.com", UserRole.Student, null);
      createUser("S2", "s2@example.com", UserRole.Student, null);
      createUser("I1", "i1@example.com", UserRole.Instructor, null);

      expect(getUsersByRole(UserRole.Student)).toHaveLength(2);
      expect(getUsersByRole(UserRole.Instructor)).toHaveLength(1);
      expect(getUsersByRole(UserRole.Admin)).toHaveLength(0);
    });
  });

  describe("updates", () => {
    it("updateUser changes name, email and bio", () => {
      const user = createUser("Old", "old@example.com", UserRole.Student, null);
      const updated = updateUser(
        user.id,
        "New Name",
        "new@example.com",
        "A short bio"
      );

      expect(updated.name).toBe("New Name");
      expect(updated.email).toBe("new@example.com");
      expect(updated.bio).toBe("A short bio");
    });

    it("updateUserRole promotes a user", () => {
      const user = createUser(
        "Promote",
        "promote@example.com",
        UserRole.Student,
        null
      );
      const updated = updateUserRole(user.id, UserRole.Admin);
      expect(updated.role).toBe(UserRole.Admin);
    });
  });
});
