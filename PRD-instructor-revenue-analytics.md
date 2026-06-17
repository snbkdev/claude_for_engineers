# Instructor Revenue Analytics Dashboard

## Problem Statement

As an instructor on Cadence, I currently have no way to understand how my
courses are performing financially. The instructor area lets me create and edit
courses and see a per-course student roster, but there is nothing that answers
the questions I actually care about as a course author: How much money have I
made? Which of my courses earn the most? Is my revenue growing or shrinking over
time? Where in the world are my buyers? How many team seats have I sold that
haven't been claimed yet?

Today that information is locked inside the `purchases` and `coupons` tables and
is only reachable by querying the database directly. I have to guess at my own
business. Admins have the same blind spot at the platform level — there is no
single place to see total platform revenue or how it breaks down.

## Solution

A single **Revenue Analytics dashboard** for instructors, reached from an
"Analytics" link in the sidebar and living at `/instructor/analytics`.

- The dashboard spans **all of an instructor's courses at once** — it is not
  per-course. An instructor sees aggregated revenue plus a per-course breakdown.
- It opens scoped to the **last 30 days** by default, with quick presets
  (7 / 30 / 90 days, all-time) and a **custom from–to date range**.
- It shows **KPI summary cards** (total revenue, sales, average order value,
  seats sold, outstanding seats) and **tables** (per-course breakdown, revenue
  over time as period buckets, revenue by country). There are no charts in this
  version — "revenue over time" is rendered as a readable bucketed table.
- Access is restricted to **instructors and admins**. An instructor only ever
  sees data for **their own** courses. An **admin** sees **platform-wide totals**
  aggregated across every course and every instructor.

All money is displayed using the existing `$X.XX` formatting; PPP discounts are
already reflected in what each buyer paid, so the numbers represent actual gross
revenue collected.

## User Stories

1. As an instructor, I want an "Analytics" link in my sidebar, so that I can find
   my revenue dashboard without hunting through course editors.
2. As an instructor, I want a single dashboard covering all my courses, so that I
   can understand my whole business at a glance instead of course-by-course.
3. As an instructor, I want to see my total gross revenue for the selected period,
   so that I know how much money my courses brought in.
4. As an instructor, I want to see an all-time total revenue figure that persists
   regardless of the selected range, so that I always have my lifetime number in
   view.
5. As an instructor, I want to see how many sales (transactions) happened in the
   period, so that I can gauge demand independent of price.
6. As an instructor, I want my average order value (AOV) for the period, so that I
   understand how much a typical purchase is worth.
7. As an instructor, I want to see how many seats I sold (counting each seat in a
   team purchase), so that I know the true headcount reached, not just the number
   of deals.
8. As an instructor, I want to see how many seats I've sold that remain unredeemed,
   so that I can follow up with team buyers who haven't distributed access.
9. As an instructor, I want a per-course breakdown table showing revenue, sales,
   and seats for each of my courses, so that I can see which courses earn the most.
10. As an instructor, I want to sort the per-course breakdown by revenue, so that
    my best performers surface to the top.
11. As an instructor, I want a "revenue over time" table that buckets the selected
    range into readable periods, so that I can see whether my income is trending up
    or down.
12. As an instructor, I want the time buckets to adapt to the range length (daily
    for short ranges, weekly for medium, monthly for long), so that the table is
    never overwhelming or uselessly sparse.
13. As an instructor, I want a revenue-by-country table, so that I can understand
    where my buyers are and how PPP pricing affects different regions.
14. As an instructor, I want country codes shown as full country names, so that the
    breakdown is readable without me decoding ISO codes.
15. As an instructor, I want purchases with no recorded country grouped under an
    "Unknown" row, so that those sales aren't silently dropped from the totals.
16. As an instructor, I want quick range presets (7 / 30 / 90 days, all-time), so
    that I can switch windows in one click.
17. As an instructor, I want a custom from–to date range, so that I can analyze any
    specific window (e.g. a launch week or a sale).
18. As an instructor, I want the dashboard to default to the last 30 days, so that I
    land on a recent, actionable view.
19. As an instructor, I want $0 / free-course purchases excluded from revenue, sales,
    and AOV, so that my financial metrics aren't distorted by free signups.
20. As an instructor, I want a clear empty state when I have no sales (yet), so that
    a new or low-traffic course doesn't look like a broken page.
21. As an instructor, I want my dashboard to never show another instructor's data,
    so that my and others' figures stay private.
22. As an admin, I want to open the same Analytics dashboard and see platform-wide
    totals across all courses and instructors, so that I can understand overall
    platform revenue.
23. As an admin, I want the same KPI cards, per-course breakdown, over-time table,
    and by-country table at the platform level, so that I have a consistent view.
24. As an admin, I want the per-course breakdown at platform scope to include every
    course (across instructors), so that I can see top earners platform-wide.
25. As a student, I want to be denied access to the analytics dashboard, so that
    revenue data is never exposed to non-authors.
26. As any unauthenticated visitor, I want to be blocked from the dashboard, so that
    financial data is never public.
27. As an instructor, I want amounts shown in the platform's standard `$X.XX`
    formatting, so that figures are consistent with the rest of the app.
28. As an instructor, I want the selected date range reflected in the page (e.g. via
    URL query params), so that I can bookmark or share a specific view and reloads
    preserve my selection.

## Implementation Decisions

### Scope resolution & authorization
- Authorization reuses the existing instructor-route pattern: resolve the current
  user, require role `instructor` or `admin`, otherwise throw `data(..., {status})`
  (401 when no user, 403 when wrong role).
- The route — not the service — decides **which course IDs** to analyze:
  - **Instructor:** the IDs of courses they own (`getCoursesByInstructor`).
  - **Admin:** **all** course IDs (platform-wide aggregation; no instructor picker,
    no drill-in in this version).
- An instructor can never widen scope beyond their own courses.

### New deep module: analytics aggregation service
- A new analytics service is the rarely-changing core. It is **auth-agnostic** and
  **synchronous** (better-sqlite3), matching existing service conventions
  (object params for same-typed args, `// ─── X Service ───` header).
- It accepts a **list of course IDs** plus an optional `from`/`to` range and returns
  aggregated figures. Proposed interface (names indicative):
  - `getRevenueSummary({ courseIds, from?, to? })` → period totals:
    total revenue, transaction count, AOV, seats sold, outstanding seats.
  - `getRevenueByCourse({ courseIds, from?, to? })` → per-course rows
    (course id/title, revenue, transactions, seats).
  - `getRevenueByCountry({ courseIds, from?, to? })` → rows of
    (country, revenue, transactions), with `null` country bucketed as "Unknown".
  - `getRevenueTimeSeries({ courseIds, from?, to?, granularity })` → ordered period
    buckets (period start, label, revenue, transactions).
- The "all-time total revenue" KPI is obtained by calling the summary with no range;
  all other cards use the selected range.

### Revenue & counting semantics
- **Revenue** = sum of `purchases.pricePaid` for the in-scope course IDs whose
  `createdAt` falls in range and whose `pricePaid > 0`. Stored as integer cents;
  displayed via the existing `$X.XX` formatter.
- **Transactions (sales count)** = number of qualifying purchase rows (a team/bulk
  purchase is **one** transaction). $0 purchases are excluded.
- **Seats sold** = per purchase, the number of seats it represents — a team purchase
  contributes its coupon count (seats), an individual purchase contributes 1. This
  is reported **separately** from transaction count.
- **Outstanding seats** = coupons in scope that are sold but not yet redeemed
  (no `redeemedByUserId`). Surfaced as its own KPI.
- **AOV** = period revenue ÷ period transaction count (qualifying transactions only);
  shown as `$0.00` when there are no transactions.
- Coupon **redemptions create enrollments but no new purchase row**, so summing
  `purchases.pricePaid` does not double-count team seats.
- PPP is already baked into `pricePaid`; no separate discount math. Single currency
  (USD cents) throughout — no multi-currency handling.

### Time range & bucketing
- Range comes from URL query params (presets + custom from–to); default = last 30 days.
- Date filtering is on `purchases.createdAt` (ISO strings). Bucketing/boundaries are
  computed in **UTC** for deterministic, testable results.
- **Auto granularity** for the over-time table, chosen from range length: daily for
  ranges up to ~31 days, weekly up to ~3 months, monthly beyond.

### Pure helper module (no DB)
- Date bucketing / granularity selection and ISO-code→country-name lookup are
  extracted into pure functions with no DB dependency, so they can be unit-tested in
  isolation. The country-name map covers the codes the app actually records.

### Route & UI
- New route registered at `/instructor/analytics`, nested under the app layout.
- The loader resolves scope + range, calls the analytics service, and returns plain
  data; the component renders KPI cards + tables (no charts). Tables: per-course
  breakdown (sortable by revenue), revenue-over-time buckets, revenue-by-country.
- A new "Analytics" link is added to the sidebar, shown to instructors and admins.
- Empty/zero states are handled for instructors with no qualifying sales.

### Schema
- **No schema changes.** All required data already exists in `purchases`, `coupons`,
  and `courses`. No new migration is needed.

### Testing
- **analyticsService against an in-memory DB** (existing `*Service.test.ts` pattern
  with `createTestDb` + the `~/db` mock): revenue sums, exclusion of $0 purchases,
  team-purchase transaction-vs-seats counting, outstanding seats, country bucketing
  (including "Unknown"), and date-range filtering.
- **Pure helpers** unit-tested in isolation: granularity selection across range
  lengths, period bucket boundaries, and country-name lookup.
- **Route loader** tested for authorization (instructor/admin only; student and
  anonymous rejected) and correct course-ID scoping (instructor → own courses only;
  admin → all courses).

## Implementation Plan (Phased)

The work is sequenced bottom-up by dependency: pure logic first, then the
DB-backed core, then the route/loader, then the UI, then admin scope and polish.
Each phase leaves the codebase green (`pnpm typecheck` + `pnpm test` passing) and
is independently reviewable. Earlier phases ship real, tested value even if later
phases slip.

### Phase 1 — Pure helpers (no DB)
**Goal:** the deterministic, dependency-free logic that everything else builds on.
- Date-range utilities: resolve a preset (7 / 30 / 90 days, all-time) or a custom
  from–to into a normalized `{ from, to }` (UTC boundaries; inclusive day handling).
- `selectGranularity(from, to)` → `daily | weekly | monthly` (daily ≤ ~31 days,
  weekly ≤ ~3 months, monthly beyond).
- `bucketPeriods(from, to, granularity)` → ordered period boundaries + labels.
- ISO-code → country-name lookup covering the codes the app records; unknown/`null`
  resolves to "Unknown".

**Tests:** unit tests in isolation — granularity thresholds (incl. boundaries),
bucket boundaries across daily/weekly/monthly, preset/custom normalization, and
country-name lookup (known code, unknown code, `null`).
**Exit criteria:** helpers fully tested and green; no app wiring yet.
**Covers stories:** 12, 14, 15, 16, 17, 18 (logic only).

### Phase 2 — Analytics aggregation service (DB-backed core)
**Goal:** the deep, auth-agnostic module that turns a course-ID list + range into
numbers. Depends on Phase 1 for granularity/bucketing.
- New service (synchronous, object-param convention, `// ─── X Service ───` header):
  - `getRevenueSummary({ courseIds, from?, to? })` → total revenue, transaction
    count, AOV, seats sold, outstanding seats.
  - `getRevenueByCourse({ courseIds, from?, to? })` → per-course rows.
  - `getRevenueByCountry({ courseIds, from?, to? })` → rows with `null` → "Unknown".
  - `getRevenueTimeSeries({ courseIds, from?, to?, granularity })` → ordered buckets.
- Enforces the counting semantics: `pricePaid > 0` only; team buy = 1 transaction
  but N seats; outstanding = unredeemed coupons; all-time = summary with no range.

**Tests:** against an in-memory DB (`createTestDb` + `~/db` mock) — revenue sums,
$0 exclusion, individual-vs-team transaction/seat counting, outstanding seats,
country bucketing incl. "Unknown", date-range filtering, and empty-scope returns.
**Exit criteria:** service fully tested and green; callable in isolation.
**Covers stories:** 3, 4, 5, 6, 7, 8, 9, 11, 13, 19 (data layer).

### Phase 3 — Route, loader & authorization
**Goal:** wire the service to a real, secured endpoint that resolves scope and range.
- Register `/instructor/analytics` under the app layout.
- Loader: resolve current user → require `instructor` or `admin` (401/403 via
  `data(...)`); resolve course IDs (instructor → own courses; admin → all courses);
  parse range from URL query params (default last 30 days); call the service and
  return plain data.

**Tests:** loader tests — anonymous → 401, student → 403, instructor sees only own
courses, admin scope spans all courses, and query-param range parsing (default +
custom).
**Exit criteria:** endpoint returns correct, authorized data (renderable as JSON
even before the UI is built).
**Covers stories:** 21, 22, 24, 25, 26, 28 (and admin scope for 23).

### Phase 4 — Dashboard UI
**Goal:** the page an instructor actually uses.
- KPI summary cards: total revenue (period) + persistent all-time total, sales,
  AOV, seats sold, outstanding seats — all via the existing `$X.XX` formatter.
- Tables: per-course breakdown (sortable by revenue), revenue-over-time buckets,
  revenue-by-country (full country names, "Unknown" row).
- Range controls: preset buttons + custom from–to picker, reflected in URL.
- Empty/zero states for instructors with no qualifying sales.
- "Analytics" sidebar link shown to instructors and admins.

**Tests:** none new required at this boundary beyond Phase 3 (UI verified manually /
via existing patterns); add component tests only if a piece warrants it.
**Exit criteria:** dashboard renders all KPIs/tables, range controls work, empty
states look intentional, link appears for the right roles.
**Covers stories:** 1, 2, 10, 20, 23, 27 (and surfaces all data stories visually).

### Phase 5 — Polish & verification
**Goal:** confirm the whole flow end-to-end and tidy edges.
- Verify admin platform-wide totals reconcile with per-course/by-country tables.
- Confirm sorting, range switching, and bookmarkable URLs behave on reload.
- Final `pnpm typecheck`, full `pnpm test`, and `pnpm build`; manual pass as
  instructor (own courses only) and admin (all courses).
- Update the CLAUDE.md changelog entry.

**Exit criteria:** all green; manual verification done for both roles.

### Dependency summary
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5. Phases 1 and 2 are the deep,
heavily-tested modules; 3 adds the security boundary; 4 is presentation; 5 is
verification. No schema changes in any phase.

## Out of Scope

- **Charts / graphs.** Revenue-over-time is a bucketed table; no charting library is
  added in this version.
- **Admin drill-in / instructor picker.** Admins see platform-wide totals only; no
  ability to view a single instructor's dashboard in isolation.
- **Refunds, chargebacks, net revenue, payouts, fees, or taxes.** There is no refund
  concept in the data model; figures are gross revenue collected.
- **Multi-currency.** All amounts are a single currency in integer cents.
- **Per-course analytics pages.** This is one cross-course dashboard, not per-course
  views.
- **Forecasting, cohort analysis, conversion funnels, or marketing-attribution
  metrics.**
- **Exporting (CSV/PDF) or scheduled email reports.**
- **Real-time updates.** The dashboard reflects data at load time.
- **Non-revenue analytics** (engagement, completion, quiz performance) — the student
  roster already covers progress/quiz data per course.

## Further Notes

- The analytics service is intentionally auth-agnostic and scoped by a list of course
  IDs. This keeps it a deep, stable module: the same functions serve the instructor
  (own courses) and admin (all courses) views, and authorization stays in the route
  layer where the rest of the app puts it.
- Because coupon redemptions never create purchase rows, revenue is computed purely
  from `purchases`; coupons are consulted only for seat counts (sold vs outstanding).
- Older purchase rows may have a `null` country; these are grouped under "Unknown"
  rather than dropped, so the by-country revenue reconciles with the total.
- UTC bucketing is a deliberate choice for deterministic tests and server/client
  agreement; if localized day boundaries are ever needed, that would be a follow-up.
