# Instructor Revenue Analytics — Issue Breakdown

Vertical-slice (tracer-bullet) issues derived from `PRD-instructor-revenue-analytics.md`
(parent PRD referenced as `#57`). Each slice cuts end-to-end (service → route → UI →
tests) and is independently demoable.

**7 AFK build slices + 1 HITL QA.** Create them top-to-bottom and replace each
`#SLICE-N` placeholder in "Blocked by" with the real issue number GitHub assigns.

## Dependency graph

```
#1 ─▶ #2 ─┬─▶ #3
          ├─▶ #4 ─┐
          ├─▶ #5 ─┼─▶ #7 ─▶ #8 (QA, HITL)
          └─▶ #6 ─┘
```

---

## Issue 1 — Walking skeleton: secured `/instructor/analytics` route + total-revenue KPI

**Type:** AFK

## Parent PRD

#57

## What to build

A thin end-to-end slice: a new `/instructor/analytics` route (nested under the app layout) that authorizes the viewer, resolves which course IDs are in scope, and renders a single "Total revenue" KPI. Revenue is summed from `purchases.pricePaid` for the in-scope courses, excluding $0 purchases. Adds an "Analytics" sidebar link for instructors and admins. See PRD "Scope resolution & authorization" and "Revenue & counting semantics".

## Acceptance criteria

- [ ] `GET /instructor/analytics` returns 401 for anonymous, 403 for students
- [ ] Instructor scope = own courses (`getCoursesByInstructor`); admin scope = all courses
- [ ] New auth-agnostic `analyticsService.getRevenueSummary({ courseIds })` sums `pricePaid`, excludes `$0`
- [ ] Page shows one "Total revenue" KPI in `$X.XX` format
- [ ] "Analytics" link appears in the sidebar for instructors + admins
- [ ] Service test (revenue sum, $0 exclusion) + loader test (auth + scope) pass

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1, 2, 3, 21, 25, 26, 27

---

## Issue 2 — Date-range scoping (presets + custom range + URL params + all-time)

**Type:** AFK

## Parent PRD

#57

## What to build

Add a selectable date range to the dashboard. A pure `resolveRange` helper normalizes `?preset=7d|30d|90d|all` or `?from=&to=` into UTC bounds (default last 30 days). The summary service gains optional `from`/`to` filtering on `purchases.createdAt`. The page renders preset buttons + a custom from–to form, with the selection carried in URL query params, and shows both a period and an all-time revenue KPI. See PRD "Time range & bucketing" and stories 16–18, 28.

## Acceptance criteria

- [ ] Pure `resolveRange` helper with UTC bounds; default = last 30 days; unit-tested across presets + custom range
- [ ] `getRevenueSummary` filters by `from`/`to` (inclusive start, exclusive end) when provided
- [ ] Preset buttons (7/30/90/all) + custom from–to form; selection reflected in URL and preserved on reload
- [ ] All-time revenue KPI persists regardless of selected range
- [ ] Service + loader range tests pass

## Blocked by

- Blocked by #SLICE-1

## User stories addressed

- User story 4, 16, 17, 18, 28

---

## Issue 3 — Full KPI set: sales, AOV, seats sold, outstanding seats

**Type:** AFK

## Parent PRD

#57

## What to build

Expand the summary into the full KPI card set. `getRevenueSummary` also returns transaction count, average order value (revenue ÷ qualifying transactions, `$0.00` when none), and seats sold (a team purchase contributes its coupon count; an individual purchase contributes 1). A new snapshot function `getOutstandingSeats({ courseIds })` counts in-scope coupons that are sold but unredeemed. See PRD "Revenue & counting semantics".

## Acceptance criteria

- [ ] Summary returns `transactionCount`, `averageOrderValue`, `seatsSold` (team = coupon count, individual = 1)
- [ ] $0 purchases excluded from revenue, sales, and AOV
- [ ] `getOutstandingSeats` counts unredeemed in-scope coupons (not period-scoped)
- [ ] KPI cards rendered: Sales, Avg order value, Seats sold, Outstanding seats
- [ ] Service tests cover team-vs-individual seat counting + outstanding seats

## Blocked by

- Blocked by #SLICE-2

## User stories addressed

- User story 5, 6, 7, 8, 19

---

## Issue 4 — Per-course breakdown table (sortable by revenue)

**Type:** AFK

## Parent PRD

#57

## What to build

A per-course breakdown table. `getRevenueByCourse({ courseIds, from?, to? })` returns one row per in-scope course (id, title, revenue, transactions, seats), including courses with no sales, sorted by revenue desc. The table is client-sortable (default revenue desc) with an empty state. At admin scope it includes every course across instructors. See PRD stories 9, 10, 20, 24.

## Acceptance criteria

- [ ] `getRevenueByCourse` returns a row per course incl. zero-sale courses, sorted revenue desc
- [ ] Table columns: Course / Revenue / Sales / Seats; client-sortable; default revenue desc
- [ ] Empty state shown when there are no courses/sales
- [ ] Admin scope includes all courses across instructors
- [ ] Service test (sort, zero-sale, scope, range) + loader scoping test pass

## Blocked by

- Blocked by #SLICE-2

## User stories addressed

- User story 9, 10, 20, 24

---

## Issue 5 — Revenue-over-time bucketed table (auto granularity)

**Type:** AFK

## Parent PRD

#57

## What to build

A "revenue over time" table that buckets the selected range into readable periods. Pure helpers `selectGranularity` (daily ≤~31d, weekly ≤~3mo, monthly beyond) and `bucketPeriods` (contiguous UTC-aligned buckets, exclusive end, human labels). `getRevenueTimeSeries({ courseIds, from?, to?, granularity? })` returns ordered buckets (period start, label, revenue, transactions); empty buckets render as zeros. See PRD "Time range & bucketing" + stories 11, 12.

## Acceptance criteria

- [ ] Pure `selectGranularity` + `bucketPeriods` unit-tested (range lengths, boundaries)
- [ ] `getRevenueTimeSeries` returns contiguous ordered buckets, empty buckets = zeros
- [ ] Auto granularity picked from range length when none passed
- [ ] Table renders Period / Revenue / Sales
- [ ] Service + loader tests pass

## Blocked by

- Blocked by #SLICE-2

## User stories addressed

- User story 11, 12

---

## Issue 6 — Revenue-by-country table (full names + "Unknown" bucket)

**Type:** AFK

## Parent PRD

#57

## What to build

A revenue-by-country table. A pure `countryName` helper maps ISO codes to full names (null/unrecognized → "Unknown"). `getRevenueByCountry({ courseIds, from?, to? })` groups revenue + transactions by resolved country name (null collapses into one "Unknown" row), sorted revenue desc, reconciling with the period total. See PRD stories 13–15 and "Further Notes".

## Acceptance criteria

- [ ] Pure `countryName` helper (ISO→name; null/unknown → "Unknown"); unit-tested
- [ ] `getRevenueByCountry` groups + sorts by revenue desc; "Unknown" row for null country
- [ ] By-country revenue reconciles with the period total
- [ ] Table renders Country / Revenue / Sales
- [ ] Service test (grouping, Unknown bucket, range) passes

## Blocked by

- Blocked by #SLICE-2

## User stories addressed

- User story 13, 14, 15

---

## Issue 7 — Admin platform parity, empty states & reconciliation

**Type:** AFK

## Parent PRD

#57

## What to build

Final polish ensuring the admin platform-wide view is consistent across every section, and all tables degrade gracefully. Verify admin all-course scope flows through summary, per-course, over-time, and by-country. Add intentional empty states to all tables. Add a loader test reconciling admin platform-wide totals (summary == per-course sum == over-time sum == by-country sum) for the period. See PRD stories 20, 22–24.

## Acceptance criteria

- [ ] Admin sees platform-wide totals across all four sections
- [ ] Every table has an intentional empty state (no courses / no sales)
- [ ] Loader test reconciles admin totals across summary, per-course, over-time, by-country
- [ ] `pnpm typecheck` + full test suite + `pnpm build` green

## Blocked by

- Blocked by #SLICE-4, #SLICE-5, #SLICE-6

## User stories addressed

- User story 20, 22, 23, 24

---

## Issue 8 — Manual QA pass

**Type:** HITL

## Parent PRD

#57

## What to build

Human verification of the complete Revenue Analytics dashboard against the PRD acceptance criteria. Manual, exploratory QA — the last item in the dependency graph.

## Acceptance criteria

- [ ] **Auth matrix:** anonymous → 401; student → 403; instructor → own data only; admin → platform-wide
- [ ] **Privacy:** an instructor never sees another instructor's figures
- [ ] **Range:** default is last 30 days; 7/30/90/all presets work; custom from–to works; selection survives reload and is shareable via URL
- [ ] **All-time KPI** stays fixed regardless of selected range
- [ ] **Counting:** $0/free purchases excluded from revenue/sales/AOV; team purchase = 1 transaction but N seats; outstanding seats = unredeemed coupons
- [ ] **Per-course table** sortable by revenue; zero-sale courses listed
- [ ] **Over-time table** granularity adapts (daily/weekly/monthly) to range length
- [ ] **By-country table** shows full names; null countries appear under "Unknown"; totals reconcile
- [ ] **Empty states** render cleanly for an instructor with no sales
- [ ] **Formatting:** all amounts shown as `$X.XX`

## Blocked by

- Blocked by #SLICE-1, #SLICE-2, #SLICE-3, #SLICE-4, #SLICE-5, #SLICE-6, #SLICE-7

## User stories addressed

- User story 20, 25, 26 (and full PRD acceptance verification)
