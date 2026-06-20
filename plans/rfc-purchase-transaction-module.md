# RFC: Deepen the Purchase Transaction into a single module

## Problem

A single user-facing purchase is fragmented across **five** services with no transactional boundary, and the only place that knows the _sequence_ is a route action.

- `purchaseService.createTeamPurchase()` chains `createPurchase → getOrCreateTeamForUser → generateCoupons` as separate, individually-committed statements. **If coupon #3 of N throws, the purchase row and 2 coupons are already committed** — an orphaned, half-finished team purchase. The self-purchase path has the same flaw: `createPurchase` then `enrollUser` are two writes with no shared commit.
- `couponService.redeemCoupon()` is a ~70-line function bundling 5 validation steps + the enrollment insert + a private `notifyTeamAdminsOfRedemption()` that re-derives seat counts with its own `count(*)` queries. Validation, the write, and the side-effect all live in one path.
- **PPP / country-match logic is duplicated**: the purchase action computes `calculatePppPrice(...)`, and the redeem flow re-checks the buyer's country against `purchases.country` — once in `redeemCoupon()` and again in the redeem route's _loader_ (a hand-rolled `db.select().from(purchases)`). These can silently disagree.
- Routes (`courses.$slug.purchase.tsx`, `redeem.$code.tsx`) orchestrate the sequence, so integration risk lives in the seams between services rather than behind a boundary.
- Tests hand-seed `purchases`/`coupons` directly (e.g. `admin.analytics.test.ts`, `instructor.analytics.test.ts`), bypassing the services — so they don't catch the services drifting out of sync.

This makes the purchase concept hard to navigate (you must read 5 files + 2 routes to understand one flow) and unsafe to change (no test exercises the orchestration as a unit).

## Proposed Interface

A single deep module owns the purchase/coupon/enrollment **logic**; routes call one function each. Three free functions in the existing flat, synchronous service style (better-sqlite3 — no async in the service layer). The two common paths take only what a route already holds right after `resolveCountry`.

```ts
// app/services/transactionService.ts (name TBD; e.g. purchaseService deepened)

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// Course shape the routes already hold — avoids a re-fetch, lets the module own PPP.
type CourseLike = { id: number; price: number; pppEnabled: boolean };

// (a) Trivial default path: one student buys one course for themselves.
//     Records purchase + enrolls + notifies instructor, atomically. PPP applied internally.
export function buyForSelf(opts: {
  userId: number;
  course: CourseLike;
  country: string | null; // matches resolveCountry() exactly — no `?? ""` coercion
}): Result<{
  purchase: typeof purchases.$inferSelect;
  enrollment: typeof enrollments.$inferSelect;
}>;

// (b) Trivial default path: redeem a coupon code.
//     Validates (exists / unused / not-already-enrolled / country) + enrolls
//     + notifies team admins, atomically.
export function redeem(opts: {
  code: string;
  userId: number;
  country: string | null;
}): Result<{ enrollment: typeof enrollments.$inferSelect }>;

// (c) Team purchase: buy N seats, generate N coupons. Buyer is intentionally NOT enrolled.
export function buyForTeam(opts: {
  userId: number;
  course: CourseLike;
  country: string | null;
  quantity: number;
}): Result<{
  purchase: typeof purchases.$inferSelect;
  team: typeof teams.$inferSelect;
  coupons: (typeof coupons.$inferSelect)[];
}>;

// Shared pure predicate — single source of truth for the country rule,
// reused by redeem() AND the redeem route's loader (kills the duplicated db.select).
export function couponCountryMatches(opts: {
  purchaseCountry: string | null;
  userCountry: string | null;
}): boolean;
```

### Usage

Purchase action — the self path collapses from ~17 lines (manual PPP math, `createPurchase`, `enrollUser`, ordering) to one call:

```ts
const country = await resolveCountry(request); // async request I/O stays at the route boundary

if (parsed.data.intent === "confirm-purchase") {
  const result = buyForSelf({ userId: currentUserId, course, country });
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  throw redirect(`/courses/${slug}/welcome`);
}

const result = buyForTeam({
  userId: currentUserId,
  course,
  country,
  quantity: parsed.data.quantity,
});
if (!result.ok) return data({ error: result.error }, { status: 400 });
throw redirect(`/team`);
```

Redeem action:

```ts
const country = await resolveCountry(request);
const result = redeem({ code, userId: currentUserId, country });
if (!result.ok) return data({ error: result.error }, { status: 400 });

const course = getCourseById(result.data.enrollment.courseId);
throw redirect(course ? `/courses/${course.slug}/welcome` : "/courses");
```

The redeem **loader** drops its hand-rolled `db.select().from(purchases)` country check (and the raw `db`/`purchases`/`eq` imports) in favor of `couponCountryMatches(...)`.

### What complexity it hides internally

- **PPP / price math** — `pppEnabled ? calculatePppPrice(price, country) : price`, and `× quantity` for teams. Routes stop importing `calculatePppPrice` and stop doing money math.
- **The fixed team sequence** — `createPurchase → getOrCreateTeamForUser → generateCoupons`, now inside one transaction.
- **Redemption validation** — found / consumed / already-enrolled / country, with the country rule factored into the shared predicate.
- **Side-effect ordering & seat re-count** — enroll → mark coupon, and the admin seat-count notification.
- **The `country: string | null` handling** — one place instead of leaking `?? ""` into routes.

## Dependency Strategy

**Category: in-process / local-substitutable.** The test harness (`app/test/setup.ts`) already runs the real `drizzle/` migrations against an in-memory SQLite DB and mocks `~/db` via `vi.mock("~/db", () => ({ get db() { return testDb; } }))`. So `db` stays a direct `import { db } from "~/db"` — **not** injected. Wrapping Drizzle behind a repository port would be ceremony over an already-perfect local substitute and would forfeit `db.transaction()`.

**Transaction boundary (the core fix).** better-sqlite3 `db.transaction((tx) => { ... })` is _synchronous_: it commits on return, rolls back on throw, and must contain no async. Each write entry point wraps its mutations:

```ts
const out = db.transaction((tx) => {
  // all inserts/updates via tx.* — purchase, (team + members + coupons) | (coupon update + enrollment)
  return { ... }; // throw to roll back the whole unit
});
```

This makes "purchase exists with 1 of N coupons" structurally impossible.

**Threading `tx` into existing leaf services.** The current leaf services (`createPurchase`, `enrollUser`, `generateCoupons`, …) close over the module `db` and can't run inside a `tx`. Recommended: the deep module owns its writes directly with `tx.insert(...)` (it imports the same tables), and reuses leaf services only for _reads/validation_. This keeps the blast radius to one module + two routes. (Alternative: give leaf services an optional `tx?` param — more invasive; defer unless more transactional flows appear.)

**Side-effects (notifications) fire AFTER commit — outside the transaction.** This is the one decision that's expensive to reverse, so we draw it correctly now: a committed, paid enrollment must **not** roll back because an in-app notification (soon an email) failed to write. The transaction returns plain data; `redeem()` / `buyForSelf()` then call the notification helper, whose seat-count reads reflect committed state. (Note: this differs from a naive "notifications are just DB writes, roll them back too" approach — deliberately.)

## Testing Strategy

**New boundary tests to write** (against the three functions):

- `buyForSelf`: creates purchase + enrollment atomically; PPP price applied for PPP countries; instructor notification created; already-enrolled returns `{ ok: false }`.
- `buyForTeam`: creates purchase + team + exactly N coupons atomically; **force a mid-coupon failure and assert zero purchases/coupons committed** (the rollback invariant); buyer is NOT enrolled.
- `redeem`: happy path enrolls + marks coupon consumed + notifies admins with correct `seatsRemaining/seatsTotal`; rejects not-found / already-redeemed / already-enrolled / country-mismatch; notification fires only after a successful commit.
- `couponCountryMatches`: pure unit tests for the predicate.

**Old tests to delete / migrate:**

- `couponService.test.ts` redemption + notification assertions → move onto `redeem()`.
- Any `createTeamPurchase` tests → rewrite onto `buyForTeam`.
- In analytics route tests, hand-seeding stays valid for _arranging_ fixtures, but the _write path_ should no longer be re-implemented inline.

**Test environment needs:** none new — the existing in-memory SQLite + `vi.mock("~/db")` + `seedBaseData()` harness is sufficient (local-substitutable category).

## Implementation Recommendations

Durable guidance, not coupled to current file paths:

- **The module should own:** PPP price resolution, individual-vs-team branching, the transactional all-or-nothing write for purchase/team/coupons/enrollment, coupon generation, coupon redemption + its validation ladder, and the triggering (not the delivery) of notifications.
- **It should hide:** the multi-service sequence, the transaction mechanics, seat-count derivation, and the coupon table internals.
- **It should expose:** `buyForSelf` / `buyForTeam` / `redeem` returning a uniform `Result<T>`, plus the pure `couponCountryMatches` predicate. Errors are returned as values (for `sonner` toasts); routes decide when to `throw data()` / `redirect`.
- **Country detection stays at the route.** `resolveCountry` is async request I/O and must not enter the synchronous transaction; the module receives an already-resolved `country: string | null`.
- **Callers migrate** by deleting their PPP math, their `createPurchase`/`enrollUser`/`createTeamPurchase` call sequences, the redeem loader's `db.select(purchases)` country check, and the `isUserEnrolled` pre-check (now owned by the module's validation).

### Planned next seam (out of scope here, documented for later)

When real payment (Stripe) and email delivery land, introduce **ports** exactly where the dependencies become truly external — `PaymentPort` and `NotificationPort` — while **keeping `db` a direct import** (in-memory SQLite is already a perfect local substitute). Rule for that future change: **DB writes inside the synchronous transaction; port calls before (payment authorization) or after (notification) the transaction — never inside it.** Because `db.transaction()` is synchronous and a Stripe/email SDK is async, payment authorization should be hoisted into the async route action (which already `await`s) and the resolved charge result passed into the synchronous module. Notifications should move behind an outbox/queue so delivery is decoupled from commit. This RFC deliberately defers all of that — the after-commit notification boundary above is what makes the later migration cheap.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
