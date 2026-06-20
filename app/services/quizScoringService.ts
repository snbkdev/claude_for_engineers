import { eq, and, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  quizAttempts,
  quizAnswers,
  lessonProgress,
  LessonProgressStatus,
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
  correct: boolean;
  selectedOptionId: number | null; // null = unanswered
  correctOptionId: number | null;
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
  options: Array<{ id: number; isCorrect: boolean }>;
};

function scoreAnswers(opts: {
  questions: ScorableQuestion[];
  selectedAnswers: Record<number, number>;
}): {
  questionResults: QuestionResult[];
  totalCorrect: number;
  totalQuestions: number;
  score: number;
} {
  const { questions, selectedAnswers } = opts;
  const questionResults: QuestionResult[] = [];
  let totalCorrect = 0;

  for (const question of questions) {
    const selected = selectedAnswers[question.id] ?? null;
    const correctOption = question.options.find((o) => o.isCorrect === true);
    const correctOptionId = correctOption ? correctOption.id : null;
    const correct = selected !== null && selected === correctOptionId;
    if (correct) totalCorrect++;
    questionResults.push({
      questionId: question.id,
      correct,
      selectedOptionId: selected,
      correctOptionId,
    });
  }

  const totalQuestions = questions.length;
  const score = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;

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

// ─── Entry point 1: submit an attempt (the dominant caller) ───
// Scores answers, records the attempt + answers, and (if passed) marks the
// lesson complete — all in one transaction.

export function submitQuizAttempt(opts: {
  userId: number;
  quizId: number;
  selectedAnswers: Record<number, number>;
}): SubmitQuizResult {
  const quiz = getQuizWithQuestions(opts.quizId);
  if (!quiz) {
    return { ok: false, error: "Quiz not found" };
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
      if (result.selectedOptionId !== null) {
        tx.insert(quizAnswers)
          .values({
            attemptId: attempt.id,
            questionId: result.questionId,
            selectedOptionId: result.selectedOptionId,
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
  const selectedAnswers: Record<number, number> = {};
  for (const answer of answers) {
    selectedAnswers[answer.questionId] = answer.selectedOptionId;
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
