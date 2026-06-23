import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.server";

describe("password hashing", () => {
  it("produces a salt:key formatted hash", async () => {
    const hash = await hashPassword("hunter2!!");
    const [salt, key] = hash.split(":");
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it("uses a random salt so two hashes of the same password differ", async () => {
    const a = await hashPassword("samepassword");
    const b = await hashPassword("samepassword");
    expect(a).not.toBe(b);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
  });

  it("rejects against a null or malformed hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "notvalid")).toBe(false);
  });
});
