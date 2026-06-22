/**
 * Send any queued (pending/failed-but-retryable) emails from the outbox.
 *
 *   pnpm flush-emails
 *
 * Uses the configured EmailAdapter (Resend when RESEND_API_KEY is set, else the
 * console adapter). Runs against data.db (via ~/db). Safe to run repeatedly — it
 * only sends rows that aren't already sent and are under the attempt cap.
 */
import "dotenv/config";
import { flushEmailOutbox, getEmailAdapter } from "~/services/emailService";

async function main() {
  const adapter = getEmailAdapter();
  console.log(`Flushing email outbox via "${adapter.name}" adapter…`);
  const result = await flushEmailOutbox({ adapter });
  console.log(
    `Done: processed ${result.processed}, sent ${result.sent}, failed ${result.failed}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
