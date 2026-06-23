import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "~/db";
import { passwordResetTokens, users, UserRole } from "~/db/schema";
import {
  createUser,
  getUserByEmail,
  getUserById,
  setUserPassword,
} from "./userService";
import { hashPassword, verifyPassword } from "~/lib/password.server";
import {
  enqueueEmail,
  composeEmailBody,
  scheduleEmailDispatch,
} from "./emailService";

// ─── Auth Service ───
// Real credential auth on top of the users table: registration (email + scrypt
// password hash), login (constant-time verification), and a single-use,
// time-limited password-reset flow delivered through the email outbox. Tokens
// are stored only as SHA-256 hashes; the raw token lives in the emailed link.

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_PASSWORD_LENGTH = 8;

type User = NonNullable<ReturnType<typeof getUserById>>;
export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Register a new student account. Email must be unique; password is hashed.
export async function register(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const name = opts.name.trim();
  const email = opts.email.trim().toLowerCase();

  if (!name) return { ok: false, error: "Name is required." };
  if (opts.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (getUserByEmail(email)) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const passwordHash = await hashPassword(opts.password);
  const user = createUser({
    name,
    email,
    role: UserRole.Student,
    avatarUrl: null,
    passwordHash,
  });

  return { ok: true, user };
}

// Verify credentials. A generic error is returned for any failure (unknown
// email, no password set, or wrong password) so the response can't enumerate
// accounts.
export async function login(opts: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = opts.email.trim().toLowerCase();
  const invalid = { ok: false as const, error: "Invalid email or password." };

  const user = getUserByEmail(email);
  if (!user || !user.passwordHash) return invalid;

  const valid = await verifyPassword(opts.password, user.passwordHash);
  return valid ? { ok: true, user } : invalid;
}

// Create a reset token for the given email and email the link. Returns the raw
// token (for tests); returns null when no account matches (the caller shows a
// generic message either way so existence isn't leaked).
export async function requestPasswordReset(
  email: string
): Promise<{ token: string; userId: number } | null> {
  const user = getUserByEmail(email.trim().toLowerCase());
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  db.insert(passwordResetTokens)
    .values({ userId: user.id, tokenHash: hashToken(token), expiresAt })
    .run();

  enqueueEmail({
    recipientUserId: user.id,
    subject: "Reset your Cadence password",
    body: composeEmailBody(
      "We received a request to reset your password. This link expires in 1 hour. If you didn't request it, you can ignore this email.",
      `/reset-password?token=${token}`
    ),
  });
  scheduleEmailDispatch();

  return { token, userId: user.id };
}

// Look up a valid (unused, unexpired) reset token. Returns the row or null.
export function getValidResetToken(token: string, now: Date = new Date()) {
  return db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now.toISOString())
      )
    )
    .get();
}

// Consume a reset token and set a new password (single-use, atomic).
export async function resetPassword(opts: {
  token: string;
  password: string;
  now?: Date;
}): Promise<AuthResult> {
  if (opts.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const row = getValidResetToken(opts.token, opts.now);
  if (!row) {
    return { ok: false, error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await hashPassword(opts.password);

  db.transaction((tx) => {
    tx.update(users)
      .set({ passwordHash })
      .where(eq(users.id, row.userId))
      .run();
    tx.update(passwordResetTokens)
      .set({ usedAt: (opts.now ?? new Date()).toISOString() })
      .where(eq(passwordResetTokens.id, row.id))
      .run();
  });

  const user = getUserById(row.userId)!;
  return { ok: true, user };
}

export { MIN_PASSWORD_LENGTH };
// setUserPassword re-exported for callers that change a known user's password.
export { setUserPassword };
