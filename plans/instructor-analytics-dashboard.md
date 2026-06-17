# Instructor Revenue Analytics — Implementation Plan

Source PRD: `../PRD-instructor-revenue-analytics.md`

This plan breaks the PRD into **tracer-bullet** phases. Each phase cuts through
every layer (service → route/loader → UI → tests) end-to-end and is demoable on
its own. Phase 1 is a walking skeleton; each later phase adds one demoable
capability on top. Every phase leaves the tree green (`pnpm typecheck` +
`pnpm test`).

## Durable architectural decisions

These hold across all phases and rarely change:

- **Route:** `/instructor/analytics`, nested under the app layout. One dashboard
  spanning all of a user's in-scope courses (never per-course).
- **Date range in URL:** the selected range lives in query params (preset or
  custom from–to), so views are bookmarkable and survive reload. Default = last
  30 days.
- **Auth-agnostic analytics service:** a new service scoped by a list of course
  IDs plus an optional `from`/`to` range. It knows nothing about roles. The route
  resolves which course IDs to pass:
  - **Instructor** → IDs of courses they own.
  - **Admin** → all course IDs (platform-wide).
  Because scope is just a course-ID list, **both roles work in every phase** —
  admin "platform-wide" is inherent, not a separate feature.
- **Authorization:** instructor or admin only; reuse the existing instructor-route
  pattern (401 when no user, 403 when wrong role, via `data(...)`). An instructor
  can never widen scope beyond their own courses.
- **No schema changes.** All data already exists in `purchases`, `coupons`,
  `courses`. Reads only.
- **Money:** integer cents, displayed via the existing `$X.XX` formatter. Gross
  revenue, single currency (PPP already baked into `pricePaid`).
- **Counting semantics:** revenue/sales/AOV count only `pricePaid > 0` purchases;
  a team/bulk purchase is **1 transaction** but **N seats** (its coupon count);
  outstanding seats = unredeemed coupons in scope. Coupon redemptions create no
  purchase row, so summing `pricePaid` never double-counts.
- **Dates & bucketing:** filter on `purchases.createdAt` (ISO); compute
  boundaries/buckets in **UTC** for determinism; auto granularity (daily ≤ ~31d,
  weekly ≤ ~3mo, monthly beyond).
- **Pure helper module (no DB):** date-range normalization, granularity
  selection, period bucketing, and ISO-code → country-name lookup — unit-testable
  in isolation.

## Phases

### Phase 1 — Walking skeleton (secured route + first KPI)

**Demo:** an instructor (and an admin) navigates via a new "Analytics" sidebar
link to `/instructor/analytics` and sees a single "Total revenue" KPI computed
from real data for their scope; students and anonymous visitors are blocked.

- **Work:**
  - Register `/instructor/analytics`; add the sidebar link (instructors + admins).
  - Loader: resolve current user → require instructor/admin (401/403); resolve
    course IDs (instructor → own, admin → all).
  - Analytics service: minimal `getRevenueSummary({ courseIds })` returning total
    revenue (all-time, `pricePaid > 0`).
  - UI: one KPI card with `$X.XX` formatting.
- **Tests:** service revenue sum (incl. `$0` exclusion) against in-memory DB;
  loader auth (anon → 401, student → 403, instructor → own scope, admin → all).
- **Exit criteria:** route is secured and renders the total-revenue KPI for both
  roles; tree green.
- **Covers stories:** 1, 2, 3, 21, 22, 25, 26, 27.

### Phase 2 — Date-range scoping

**Demo:** user switches presets (7 / 30 / 90 days, all-time) and picks a custom
from–to range; the total updates, the URL reflects the selection, reload
preserves it, and a persistent all-time total sits alongside the period total.

- **Work:**
  - Pure helpers: preset/custom → normalized `{ from, to }` (UTC, inclusive days).
  - Loader: parse range from query params; default last 30 days.
  - Service: add optional `from`/`to` filtering to the summary; all-time = summary
    with no range.
  - UI: preset buttons + custom date inputs, wired to URL; show period + all-time.
- **Tests:** helper normalization (presets, custom, default); service date-range
  filtering; loader param parsing (default + custom).
- **Exit criteria:** range selection is bookmarkable and survives reload; period +
  all-time both shown; tree green.
- **Covers stories:** 4, 16, 17, 18, 28.

### Phase 3 — Full KPI set

**Demo:** the dashboard shows sales count, AOV, seats sold, and outstanding seats
for the selected range, with correct team/`$0`/outstanding handling.

- **Work:**
  - Service: extend summary with transaction count, AOV (`$0.00` when no txns),
    seats sold (team = coupon count, individual = 1), outstanding seats
    (unredeemed coupons in scope).
  - UI: additional KPI cards.
- **Tests:** individual-vs-team transaction/seat counting; `$0` exclusion from
  sales/AOV; outstanding-seat counting.
- **Exit criteria:** all summary KPIs render with correct counting semantics;
  tree green.
- **Covers stories:** 5, 6, 7, 8, 19.

### Phase 4 — Per-course breakdown table

**Demo:** a sortable table lists each in-scope course with its revenue, sales, and
seats; sorting by revenue surfaces top performers (admin sees every course).

- **Work:**
  - Service: `getRevenueByCourse({ courseIds, from?, to? })`.
  - UI: sortable table (default sort by revenue desc).
- **Tests:** per-course aggregation and scoping (instructor subset vs admin all).
- **Exit criteria:** breakdown table renders, sorts by revenue, and respects
  scope; tree green.
- **Covers stories:** 9, 10.

### Phase 5 — Revenue-over-time table

**Demo:** a table buckets the selected range into readable periods (daily/weekly/
monthly chosen automatically) showing revenue and transactions per bucket.

- **Work:**
  - Pure helpers: `selectGranularity(from, to)` + `bucketPeriods(...)`.
  - Service: `getRevenueTimeSeries({ courseIds, from?, to?, granularity })`.
  - UI: over-time table with period labels.
- **Tests:** granularity thresholds (incl. boundaries); bucket boundaries across
  granularities; per-bucket aggregation.
- **Exit criteria:** over-time table renders with auto granularity and correct
  per-bucket totals; tree green.
- **Covers stories:** 11, 12.

### Phase 6 — Revenue-by-country table

**Demo:** a table breaks revenue and transactions down by country using full
country names, with `null`-country sales grouped under an "Unknown" row that
reconciles with the total.

- **Work:**
  - Pure helpers: ISO-code → country-name lookup (`null`/unknown → "Unknown").
  - Service: `getRevenueByCountry({ courseIds, from?, to? })`.
  - UI: by-country table.
- **Tests:** country bucketing incl. "Unknown"; name lookup (known, unknown,
  `null`); totals reconcile with summary.
- **Exit criteria:** by-country table renders with full names and an "Unknown"
  bucket that reconciles with total revenue; tree green.
- **Covers stories:** 13, 14, 15.

### Phase 7 — Empty states, admin parity & polish

**Demo:** a new/low-traffic instructor sees intentional empty states (not broken
UI); an admin sees consistent platform-wide totals across every card and table;
full suite + build are green.

- **Work:**
  - UI: zero/empty states for all cards and tables.
  - Verify admin platform-wide totals reconcile across summary, per-course,
    over-time, and by-country.
  - Final `pnpm typecheck`, full `pnpm test`, `pnpm build`; manual pass as
    instructor (own courses only) and admin (all courses).
  - Update the CLAUDE.md changelog entry.
- **Exit criteria:** empty states look intentional; admin totals reconcile across
  all views; typecheck + tests + build all green; changelog updated.
- **Covers stories:** 20, 23, 24.

## Phase → story coverage

| Phase | Stories |
|-------|---------|
| 1 Walking skeleton | 1, 2, 3, 21, 22, 25, 26, 27 |
| 2 Date-range scoping | 4, 16, 17, 18, 28 |
| 3 Full KPI set | 5, 6, 7, 8, 19 |
| 4 Per-course breakdown | 9, 10 |
| 5 Revenue over time | 11, 12 |
| 6 Revenue by country | 13, 14, 15 |
| 7 Empty states, admin parity & polish | 20, 23, 24 |

All 28 user stories are covered. Each phase is demoable independently and ordered
so the walking skeleton lands first, then capabilities accrete on top.
