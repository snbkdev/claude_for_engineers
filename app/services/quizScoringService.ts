import { eq, and, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  quizAttempts,
  quizAnswers,
  lessonProgress,
  LessonProgressStatus,
  QuestionType,
} from "~/db/schema";
import {
  getQuizWithQuestions,
  getAttemptById,
  getAnswersByAttempt,
} from "./quizService";

// ─── Quiz Scoring Service ───
// Deep module owning the full "process a quiz attempt" use case: scoring,
// grade calculation, the pass decision (from quiz.passingScore), attempt +
// answer persistence, and automatic lesson completion on pass — all atomic.
// Functions with multiple same-typed params take a single object param.

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface QuestionResult {
  questionId: number;
  correct: boolean; // fully correct (per-question score === 1)
  score: number; // 0..1 partial credit for this question
  selectedOptionIds: number[]; // empty = unanswered
  correctOptionIds: number[];
  // Legacy singular fields kept for single-select consumers/UI: the first
  // selected/correct option (or null). Multi-select callers use the arrays.
  selectedOptionId: number | null;
  correctOptionId: number | null;
}

// A selection per question: a single option id or several (multi-select).
export type SelectedAnswers = Record<number, number | number[]>;

function toIdArray(value: number | number[] | undefined): number[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export interface AttemptResult {
  attemptId: number;
  score: number; // 0..1
  passed: boolean; // score >= quiz.passingScore
  grade: Grade;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
  lessonCompleted: boolean; // did THIS submission flip the lesson to Completed?
}

export type SubmitQuizResult =
  | { ok: true; result: AttemptResult }
  | { ok: false; error: string };

// The transaction handle passed to db.transaction callbacks — same query
// builder surface as `db`, scoped to the open transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Grade (single source of truth) ───

export function calculateGrade(score: number): Grade {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

// ─── Internal scoring engine (shared by submit + review) ───

type ScorableQuestion = {
  id: number;
  questionType: string; // QuestionType
  options: Array<{ id: number; isCorrect: boolean }>;
};

// Per-type scoring. Single-select (multiple_choice / true_false): all-or-nothing
// on the one correct option. Multi-select: partial credit =
// (correctSelected − incorrectSelected) / totalCorrect, clamped to [0, 1].
function scoreQuestion(
  question: ScorableQuestion,
  selectedIds: number[]
): { score: number; correctOptionIds: number[] } {
  const correctOptionIds = question.options
    .filter((o) => o.isCorrect === true)
    .map((o) => o.id);
  const correctSet = new Set(correctOptionIds);

  if (question.questionType === QuestionType.MultiSelect) {
    const totalCorrect = correctOptionIds.length;
    if (totalCorrect === 0) return { score: 0, correctOptionIds };
    let correctSelected = 0;
    let incorrectSelected = 0;
    for (const id of selectedIds) {
      if (correctSet.has(id)) correctSelected++;
      else incorrectSelected++;
    }
    const raw = (correctSelected - incorrectSelected) / totalCorrect;
    const score = Math.max(0, Math.min(1, raw));
    return { score, correctOptionIds };
  }

  // Single-select: correct iff the one chosen option is a correct option.
  const selected = selectedIds[0] ?? null;
  const score = selected !== null && correctSet.has(selected) ? 1 : 0;
  return { score, correctOptionIds };
}

function scoreAnswers(opts: {
  questions: ScorableQuestion[];
  selectedAnswers: SelectedAnswers;
}): {
  questionResults: QuestionResult[];
  totalCorrect: number;
  totalQuestions: number;
  score: number;
} {
  const { questions, selectedAnswers } = opts;
  const questionResults: QuestionResult[] = [];
  let totalCorrect = 0;
  let scoreSum = 0;

  for (const question of questions) {
    const selectedOptionIds = toIdArray(selectedAnswers[question.id]);
    const { score, correctOptionIds } = scoreQuestion(
      question,
      selectedOptionIds
    );
    const correct = score === 1;
    if (correct) totalCorrect++;
    scoreSum += score;
    questionResults.push({
      questionId: question.id,
      correct,
      score,
      selectedOptionIds,
      correctOptionIds,
      selectedOptionId: selectedOptionIds[0] ?? null,
      correctOptionId: correctOptionIds[0] ?? null,
    });
  }

  const totalQuestions = questions.length;
  const score = totalQuestions > 0 ? scoreSum / totalQuestions : 0;

  return { questionResults, totalCorrect, totalQuestions, score };
}

// Marks a lesson complete on the given transaction handle. Returns whether this
// call transitioned the lesson to Completed (false if it was already complete).
// Mirrors progressService.markLessonComplete but participates in the same
// transaction as the attempt write.
function completeLessonTx(
  tx: Tx,
  opts: { userId: number; lessonId: number }
): boolean {
  const existing = tx
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, opts.userId),
        eq(lessonProgress.lessonId, opts.lessonId)
      )
    )
    .get();

  if (existing?.status === LessonProgressStatus.Completed) {
    return false;
  }

  const completedAt = new Date().toISOString();

  if (existing) {
    tx.update(lessonProgress)
      .set({ status: LessonProgressStatus.Completed, completedAt })
      .where(eq(lessonProgress.id, existing.id))
      .run();
    return true;
  }

  tx.insert(lessonProgress)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      status: LessonProgressStatus.Completed,
      completedAt,
    })
    .run();
  return true;
}

// ─── Attempt limit ───
// A quiz allows one initial attempt plus a fixed number of retakes. Once the cap
// is reached the quiz can no longer be submitted (whether or not it was passed),
// so a student who keeps failing eventually runs out of chances at the
// certificate.
export const MAX_QUIZ_ATTEMPTS = 7; // 1 initial attempt + 6 retakes

export function countQuizAttempts(opts: {
  userId: number;
  quizId: number;
}): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, opts.userId),
        eq(quizAttempts.quizId, opts.quizId)
      )
    )
    .get();
  return row?.count ?? 0;
}

// ─── Entry point 1: submit an attempt (the dominant caller) ───
// Scores answers, records the attempt + answers, and (if passed) marks the
// lesson complete — all in one transaction.

export function submitQuizAttempt(opts: {
  userId: number;
  quizId: number;
  selectedAnswers: SelectedAnswers;
}): SubmitQuizResult {
  const quiz = getQuizWithQuestions(opts.quizId);
  if (!quiz) {
    return { ok: false, error: "Quiz not found" };
  }

  // Enforce the retake cap before recording another attempt.
  const priorAttempts = countQuizAttempts({
    userId: opts.userId,
    quizId: opts.quizId,
  });
  if (priorAttempts >= MAX_QUIZ_ATTEMPTS) {
    return {
      ok: false,
      error: `No attempts remaining. You've used all ${MAX_QUIZ_ATTEMPTS} attempts for this quiz.`,
    };
  }

  const { questionResults, totalCorrect, totalQuestions, score } = scoreAnswers(
    {
      questions: quiz.questions,
      selectedAnswers: opts.selectedAnswers,
    }
  );

  const passed = score >= quiz.passingScore;

  const { attemptId, lessonCompleted } = db.transaction((tx) => {
    const attempt = tx
      .insert(quizAttempts)
      .values({
        userId: opts.userId,
        quizId: opts.quizId,
        score,
        passed,
      })
      .returning()
      .get();

    for (const result of questionResults) {
      // One row per selected option (multi-select records several).
      for (const optionId of result.selectedOptionIds) {
        tx.insert(quizAnswers)
          .values({
            attemptId: attempt.id,
            questionId: result.questionId,
            selectedOptionId: optionId,
          })
          .run();
      }
    }

    let completed = false;
    if (passed) {
      completed = completeLessonTx(tx, {
        userId: opts.userId,
        lessonId: quiz.lessonId,
      });
    }

    return { attemptId: attempt.id, lessonCompleted: completed };
  });

  return {
    ok: true,
    result: {
      attemptId,
      score,
      passed,
      grade: calculateGrade(score),
      totalCorrect,
      totalQuestions,
      questionResults,
      lessonCompleted,
    },
  };
}

// ─── Entry point 2: review a past attempt ───
// Loads a stored attempt with its answers and the current correct option per
// question, re-deriving correctness so a single scoring engine stays the source
// of truth.

export interface AttemptReview {
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
}

export function getAttemptReview(attemptId: number): AttemptReview | null {
  const attempt = getAttemptById(attemptId);
  if (!attempt) return null;

  const quiz = getQuizWithQuestions(attempt.quizId);
  if (!quiz) return null;

  const answers = getAnswersByAttempt(attemptId);
  const selectedAnswers: Record<number, number[]> = {};
  for (const answer of answers) {
    (selectedAnswers[answer.questionId] ??= []).push(answer.selectedOptionId);
  }

  const { questionResults, totalCorrect, totalQuestions } = scoreAnswers({
    questions: quiz.questions,
    selectedAnswers,
  });

  return {
    attempt: {
      id: attempt.id,
      userId: attempt.userId,
      quizId: attempt.quizId,
      score: attempt.score,
      passed: attempt.passed,
      attemptedAt: attempt.attemptedAt,
    },
    grade: calculateGrade(attempt.score),
    totalCorrect,
    totalQuestions,
    questionResults,
  };
}

// ─── Stats / history (on the shared db, fully test-isolatable) ───

export interface QuizStats {
  totalAttempts: number;
  averageScore: number;
  highScore: number;
  lowScore: number;
  passRate: number;
}

export function getQuizStats(quizId: number): QuizStats {
  const row = db
    .select({
      totalAttempts: sql<number>`count(*)`,
      averageScore: sql<number>`coalesce(avg(${quizAttempts.score}), 0)`,
      highScore: sql<number>`coalesce(max(${quizAttempts.score}), 0)`,
      lowScore: sql<number>`coalesce(min(${quizAttempts.score}), 0)`,
      passCount: sql<number>`coalesce(sum(case when ${quizAttempts.passed} then 1 else 0 end), 0)`,
    })
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, quizId))
    .get();

  if (!row || row.totalAttempts === 0) {
    return {
      totalAttempts: 0,
      averageScore: 0,
      highScore: 0,
      lowScore: 0,
      passRate: 0,
    };
  }

  return {
    totalAttempts: row.totalAttempts,
    averageScore: row.averageScore,
    highScore: row.highScore,
    lowScore: row.lowScore,
    passRate: row.passCount / row.totalAttempts,
  };
}

export interface QuizHistoryEntry {
  attemptId: number;
  score: number;
  passed: boolean;
  grade: Grade;
  attemptedAt: string;
}

export function getUserQuizHistory(opts: {
  userId: number;
  quizId: number;
}): QuizHistoryEntry[] {
  const attempts = db
    .select()
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, opts.userId),
        eq(quizAttempts.quizId, opts.quizId)
      )
    )
    .orderBy(sql`${quizAttempts.attemptedAt} desc`)
    .all();

  return attempts.map((attempt) => ({
    attemptId: attempt.id,
    score: attempt.score,
    passed: attempt.passed,
    grade: calculateGrade(attempt.score),
    attemptedAt: attempt.attemptedAt,
  }));
}
