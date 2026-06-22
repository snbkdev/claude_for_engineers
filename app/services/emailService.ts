import { eq, and, ne, lt, desc } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "~/db";
import { emailOutbox, users, EmailStatus } from "~/db/schema";

// Parse a boolean-ish env value ("true"/"1"/"yes"/"on", case-insensitive).
function envBool(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    (value ?? "").trim().toLowerCase()
  );
}

// ─── Email Service ───
// Ports & adapters for transactional email, layered over the in-app
// notifications. createNotification enqueues an `email_outbox` row; a dispatcher
// (flushEmailOutbox) later sends each pending/failed row via the configured
// EmailAdapter and records the outcome. Send is decoupled from the request so a
// slow/broken provider never blocks (or rolls back) a notification.

// Give up after this many attempts so a permanently-bad row stops being retried.
export const MAX_EMAIL_ATTEMPTS = 5;

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

// The "port": any transport that can deliver an EmailMessage.
export interface EmailAdapter {
  name: string;
  send(message: EmailMessage): Promise<void>;
}

// Dev/default adapter — logs instead of sending, so the feature works without
// any provider credentials.
class ConsoleEmailAdapter implements EmailAdapter {
  name = "console";
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email:console] → ${message.to} | ${message.subject}\n${message.body}`
    );
  }
}

// Real adapter — used when RESEND_API_KEY is set.
class ResendEmailAdapter implements EmailAdapter {
  name = "resend";
  constructor(
    private apiKey: string,
    private from: string
  ) {}
  async send(message: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
    }
  }
}

// Real adapter — SMTP via nodemailer. Configured from MAIL_* env vars (the
// common fastapi-mail-style names): MAIL_SERVER/MAIL_PORT, MAIL_USERNAME/
// MAIL_PASSWORD, MAIL_FROM(+_NAME), MAIL_SSL_TLS (implicit TLS, port 465),
// MAIL_STARTTLS (upgrade, port 587), MAIL_VALIDATE_CERTS.
class SmtpEmailAdapter implements EmailAdapter {
  name = "smtp";
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor() {
    const useCredentials = envBool(process.env.MAIL_USE_CREDENTIALS ?? "true");
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_SERVER,
      port: Number(process.env.MAIL_PORT ?? 587),
      secure: envBool(process.env.MAIL_SSL_TLS), // true → implicit TLS (465)
      requireTLS: envBool(process.env.MAIL_STARTTLS), // true → STARTTLS (587)
      auth:
        useCredentials && process.env.MAIL_USERNAME
          ? {
              user: process.env.MAIL_USERNAME,
              pass: process.env.MAIL_PASSWORD,
            }
          : undefined,
      tls: envBool(process.env.MAIL_VALIDATE_CERTS ?? "true")
        ? undefined
        : { rejectUnauthorized: false },
    });

    const address = process.env.MAIL_FROM ?? "noreply@cadence.dev";
    const fromName = process.env.MAIL_FROM_NAME;
    this.from = fromName ? `${fromName} <${address}>` : address;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
  }
}

// Selects the adapter from the environment:
//   1. RESEND_API_KEY      → Resend
//   2. MAIL_SERVER         → SMTP (or console when MAIL_SUPPRESS_SEND is set)
//   3. otherwise           → console (dev logging, no real send)
export function getEmailAdapter(): EmailAdapter {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.EMAIL_FROM ?? "Cadence <noreply@cadence.dev>";
    return new ResendEmailAdapter(apiKey, from);
  }
  if (process.env.MAIL_SERVER && !envBool(process.env.MAIL_SUPPRESS_SEND)) {
    return new SmtpEmailAdapter();
  }
  return new ConsoleEmailAdapter();
}

// Build a self-contained email body from a notification's message + link. An
// optional APP_URL makes the link absolute (and thus clickable in a real inbox).
export function composeEmailBody(message: string, linkUrl: string): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const href = linkUrl.startsWith("http") ? linkUrl : `${base}${linkUrl}`;
  return `${message}\n\nView it here: ${href}`;
}

// Enqueue an email for a recipient user. Resolves the recipient's address; if
// the user (or email) is missing, nothing is queued.
export function enqueueEmail(opts: {
  recipientUserId: number;
  subject: string;
  body: string;
}) {
  const user = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, opts.recipientUserId))
    .get();
  if (!user?.email) return null;

  return db
    .insert(emailOutbox)
    .values({
      recipientUserId: opts.recipientUserId,
      toEmail: user.email,
      subject: opts.subject,
      body: opts.body,
    })
    .returning()
    .get();
}

// Rows still eligible for sending: not yet sent and under the attempt cap.
export function getDeliverableEmails(limit: number) {
  return db
    .select()
    .from(emailOutbox)
    .where(
      and(
        ne(emailOutbox.status, EmailStatus.Sent),
        lt(emailOutbox.attempts, MAX_EMAIL_ATTEMPTS)
      )
    )
    .orderBy(emailOutbox.id)
    .limit(limit)
    .all();
}

export function listOutbox(limit: number) {
  return db
    .select()
    .from(emailOutbox)
    .orderBy(desc(emailOutbox.id))
    .limit(limit)
    .all();
}

// ─── Automatic background dispatch ───
// Kick off delivery right after a notification is queued, without blocking the
// request. Runs are coalesced (at most one in flight; a request that arrives
// mid-run schedules exactly one more pass) so concurrent notifications can't
// double-send a row. Disabled under tests for determinism — they call
// flushEmailOutbox directly with an injected adapter.
let dispatchRunning = false;
let dispatchQueuedAgain = false;

export function scheduleEmailDispatch(): void {
  if (process.env.VITEST) return;
  if (dispatchRunning) {
    dispatchQueuedAgain = true;
    return;
  }
  dispatchRunning = true;
  void (async () => {
    try {
      do {
        dispatchQueuedAgain = false;
        await flushEmailOutbox();
      } while (dispatchQueuedAgain);
    } catch (error) {
      console.error("Email dispatch failed:", error);
    } finally {
      dispatchRunning = false;
    }
  })();
}

// Dispatcher: send every deliverable row via the adapter, recording sent/failed
// and bumping the attempt count. Adapter is injectable for tests.
export async function flushEmailOutbox(opts?: {
  adapter?: EmailAdapter;
  limit?: number;
}): Promise<{ processed: number; sent: number; failed: number }> {
  const adapter = opts?.adapter ?? getEmailAdapter();
  const rows = getDeliverableEmails(opts?.limit ?? 50);

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await adapter.send({
        to: row.toEmail,
        subject: row.subject,
        body: row.body,
      });
      db.update(emailOutbox)
        .set({
          status: EmailStatus.Sent,
          attempts: row.attempts + 1,
          error: null,
          sentAt: new Date().toISOString(),
        })
        .where(eq(emailOutbox.id, row.id))
        .run();
      sent++;
    } catch (error) {
      db.update(emailOutbox)
        .set({
          status: EmailStatus.Failed,
          attempts: row.attempts + 1,
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(emailOutbox.id, row.id))
        .run();
      failed++;
    }
  }

  return { processed: rows.length, sent, failed };
}
