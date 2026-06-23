import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// ─── Password hashing (server-only) ───
// Dependency-free password hashing using Node's built-in scrypt. A per-password
// random salt is stored alongside the derived key as "saltHex:keyHex".
// Verification is constant-time (timingSafeEqual).

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = (await scryptAsync(plain, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  plain: string,
  stored: string | null
): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const derived = (await scryptAsync(plain, salt, expected.length)) as Buffer;

  // Lengths must match for timingSafeEqual; guard defensively.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
