# RFC: Deepen Quiz Attempt Processing into one module

## Problem

"Submit a quiz attempt" is an orchestration smeared across `quizScoringService`, `quizService`, `progressService`, the lesson route, and `gamification` — with duplicated logic and an untestable seam.

- **Two scoring implementations that drift.** `quizScoringService.getScore()` (read-only) and `computeResult()` (read + writes the attempt/answers) re-implement the same scoring loop, each re-querying `quizzes`/`quizQuestions`/`quizOptions`.
- **`calculateGrade` duplicated in 3+ places** (inside `getScore`, `getUserQuizHistory`, `renderQuizResults`).
- **The pass rule is a hardcoded `score > 0.7`** even though `quizzes.passingScore` exists in the schema and is shown to users — the column is ignored by scoring.
- **Scoring doesn't complete the lesson.** Passing a quiz today does _not_ mark the lesson complete; only the separate "Mark complete" button does. The route is the de-facto orchestrator and never wires quiz-pass → completion.
- **A raw `new Database("data.db")` lives at module top** for `getQuizStats()`/`getUserQuizHistory()`. The test file explicitly documents skipping these because the `~/db` mock can't reach the second connection — so part of the module is untestable.
- **No transaction.** `computeResult` inserts the attempt, then loops answer inserts with no atomicity; a mid-write failure leaves a partial attempt.

Net: the quiz concept is hard to navigate (route + 4 services) and unsafe to change (the orchestration has no boundary test, and half the module can't be isolated).

## Proposed Interface

A deepened `quizScoringService.ts` (the scoring logic consolidated; CRUD primitives stay in `quizService`). Two trivial entry points for the two common cases, one pure grade helper, and the stats/history functions folded back onto the shared `db`. Synchronous, object params, discriminated results — matching the codebase.

```ts
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface QuestionResult {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null; // null = unanswered
  correctOptionId: number | null;
}

export interface AttemptResult {
  attemptId: number;
  score: number; // 0..1
  passed: boolean; // score >= quiz.passingScore (DB-driven, not 0.7)
  grade: Grade;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
  lessonCompleted: boolean; // did THIS submission flip the lesson to Completed?
}

// (1) The dominant caller: submit answers.
//     Scores → records attempt + answers → auto-completes the lesson on pass,
//     all in ONE transaction. Caller does nothing else.
export type SubmitQuizResult =
  | { ok: true; result: AttemptResult }
  | { ok: false; error: string };

export function submitQuizAttempt(opts: {
  userId: number;
  quizId: number;
  selectedAnswers: Record<number, number>; // questionId -> selectedOptionId (omit = unanswered)
}): SubmitQuizResult;

// (2) The review read: load a past attempt with answers + correct options.
export type AttemptReview = {
  attempt: {
    id: number;
    userId: number;
    quizId: number;
    score: number;
    passed: boolean;
    attemptedAt: string;
  };
  grade: Grade;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
};
export function getAttemptReview(attemptId: number): AttemptReview | null;

// Single source of truth (replaces the 3+ duplicates).
export function calculateGrade(score: number): Grade;

// Stats / history — now on the shared db, fully test-isolatable.
export function getQuizStats(quizId: number): {
  totalAttempts: number;
  averageScore: number;
  highScore: number;
  lowScore: number;
  passRate: number;
};
export function getUserQuizHistory(opts: {
  userId: number;
  quizId: number;
}): Array<{
  attemptId: number;
  score: number;
  passed: boolean;
  grade: Grade;
  attemptedAt: string;
}>;
```

Removed from the public surface: `getScore` (the read-only twin), `computeResult` (replaced by `submitQuizAttempt`), and `renderQuizResults` (presentation moves into the `QuizSection` component, which already builds its own summary UI from the result shape).

### Usage

Lesson route action (`courses.$slug.lessons.$lessonId.tsx`, the `submit-quiz` branch) shrinks to argument marshaling — `markLessonComplete` and any XP plumbing disappear from the quiz path:

```ts
import { submitQuizAttempt } from "~/services/quizScoringService";

if (intent === "submit-quiz") {
  const quizId = Number(formData.get("quizId"));
  if (isNaN(quizId)) throw data("Invalid quiz ID", { status: 400 });

  const selectedAnswers: Record<number, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("question-")) {
      const questionId = Number(key.replace("question-", ""));
      const optionId = Number(value);
      if (!isNaN(questionId) && !isNaN(optionId))
        selectedAnswers[questionId] = optionId;
    }
  }

  const outcome = submitQuizAttempt({
    userId: currentUserId,
    quizId,
    selectedAnswers,
  });
  if (!outcome.ok) throw data(outcome.error, { status: 400 });

  return { quizResult: outcome.result }; // includes lessonCompleted for instant UI
}
```

The `mark-complete` intent stays as-is. `QuizSection`'s `quizResult` type gains one field (`lessonCompleted`) and otherwise matches the old `computeResult` shape, so results rendering is unchanged.

### What complexity it hides internally

- **One scoring engine.** A private `scoreAnswers({ quiz, questions, selectedAnswers })` walks questions once and looks up the correct option per question uniformly for `multiple_choice` and `true_false` (the old code branched needlessly). Produces `QuestionResult[]` + counts. Kills the `getScore`/`computeResult` drift.
- **Pass threshold** reads `quiz.passingScore`; the `> 0.7` magic number is gone.
- **Grade** comes only from `calculateGrade`; history and review call it instead of re-inlining the ladder.
- **Persistence + completion as one unit** — attempt insert, answer inserts, and conditional lesson completion run inside one transaction.
- **Lesson resolution** — `lessonId` is derived from the quiz row; callers never pass it.
- **Idempotent completion** — `lessonCompleted` is true only if this call transitioned the lesson (false if already complete or the attempt failed), so the UI message is honest.

## Dependency Strategy

**Category: in-process / local-substitutable.** The only dependency is `~/db`, which the test harness substitutes with real `drizzle/` migrations on in-memory SQLite via `vi.mock("~/db", () => ({ get db() { return testDb; } }))`.

- **Fold the raw connection back onto `~/db`.** Delete `const rawDb = new Database("data.db")` and the `better-sqlite3` import. Reimplement `getQuizStats` as a Drizzle aggregate over `quizAttempts` (`count`, `avg(score)`, `max`, `min`, `sum(case when passed)` with a zero-attempt fallback), mirroring existing patterns in `quizService` (`getAttemptCountForQuiz`, `getBestAttempt`). Reimplement `getUserQuizHistory` as an attempts-by-user query mapped through `calculateGrade`. This is the key isolation win — both functions become reachable through the existing mock, and the test file's "intentionally not tested" caveat is deleted.
- **Transaction approach.** Wrap the writes in better-sqlite3's synchronous `db.transaction((tx) => { ... })`: insert `quizAttempts` (`.returning().get()`), loop `quizAnswers` inserts (`.run()`, skipping unanswered questions to respect the `selectedOptionId NOT NULL` FK), and on a pass run lesson completion. Because `progressService.markLessonComplete` is bound to the module `db`, completion participates in the transaction via a small internal `completeLessonTx(tx, { userId, lessonId })` mirroring its upsert (returning whether it flipped non-complete → complete). The read/scoring phase can run before the transaction. The callback is synchronous, so it returns the built `AttemptResult` directly — no async leaks into the service layer (and this is the codebase's first `db.transaction` usage).
- **XP is left derived — no recompute.** There is no XP table; `computeXp`/`levelFromXp` derive XP from `getCompletedLessonCount` at dashboard load. Because the completion now lands in `lesson_progress` as part of the submit, XP is automatically correct on the next dashboard render. The module deliberately does **not** return an XP snapshot (it would be extra user-wide reads producing a value the dashboard re-derives anyway).

## Testing Strategy

**New boundary tests to write** (against the two entry points + helper):

- `submitQuizAttempt`: scores MC + TF correctly; `passed` honors a non-0.7 `passingScore` (and the exact-boundary case); records exactly the answered questions; **passing auto-completes the lesson and sets `lessonCompleted: true`**; failing leaves the lesson incomplete and `lessonCompleted: false`; re-passing an already-complete lesson returns `lessonCompleted: false`; force a mid-write failure and assert no partial attempt/answers are committed (transaction invariant); unknown quiz returns `{ ok: false }`.
- `getAttemptReview`: returns answers + correct options + grade for a stored attempt; `null` for a missing attempt; correctness re-derived from current options.
- `calculateGrade`: pure unit tests across band boundaries.
- `getQuizStats` / `getUserQuizHistory`: **now testable** through the in-memory mock — aggregates, pass rate, zero-attempt fallback, grade mapping.

**Old tests to delete / migrate:** the existing `quizScoringService.test.ts` cases for `getScore`/`computeResult`/`renderQuizResults` port onto `submitQuizAttempt`/`getAttemptReview` (keep the 0.5-fails / grade-A assertions). Delete the "intentionally not tested" caveat for the stats functions.

**Test environment needs:** none new — existing in-memory SQLite + `vi.mock("~/db")` + `seedBaseData()` is sufficient.

## Implementation Recommendations

Durable guidance, not coupled to current paths:

- **The module should own:** scoring across question types, grade calculation, the pass decision (from `quiz.passingScore`), attempt + answer persistence, automatic lesson completion on pass, and the `lessonCompleted` signal — all atomically.
- **It should hide:** the per-type scoring branches, the grade ladder, the transaction mechanics, and lesson-id resolution.
- **It should expose:** `submitQuizAttempt` / `getAttemptReview` returning result shapes the UI renders directly, plus the pure `calculateGrade` and the stats functions on the shared db.
- **Callers migrate** by deleting their post-score sequence (no more route-level `markLessonComplete`/XP for the quiz path) and consuming the single result; presentation strings (`renderQuizResults`) move into the component.
- **Keep question types additive (from the flexibility exploration, deliberately NOT built now):** organize scoring as a private per-`questionType` function dispatched in one place, so adding a third type later is one new branch + tests — not a rewrite. Do **not** export a `QuestionScorer` registry / strategy abstraction today: the schema has only `multiple_choice` + `true_false` (modeled identically), and weighting/partial-credit/text/numeric answers would each require schema migrations to function. Build the seam's _shape_, not the speculative machinery.

### ⚠️ Behavior changes requiring product sign-off

1. **Passing a quiz now auto-completes the lesson.** Today it does not (only the "Mark complete" button does). This changes progress — and therefore derived XP — for users who pass quizzes without clicking "Mark complete."
2. **Pass threshold becomes `score >= quiz.passingScore`** (was hardcoded `> 0.7`). Outcomes change for any quiz whose `passingScore != 0.7` and at the boundary value.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
