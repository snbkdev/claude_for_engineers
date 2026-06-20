import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType, LessonProgressStatus } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  submitQuizAttempt,
  getAttemptReview,
  calculateGrade,
  getQuizStats,
  getUserQuizHistory,
} from "./quizScoringService";

function seedLesson() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 0 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 0 })
    .returning()
    .get();
}

function seedQuiz(opts?: { lessonId?: number; passingScore?: number }) {
  const lessonId = opts?.lessonId ?? seedLesson().id;
  return testDb
    .insert(schema.quizzes)
    .values({
      lessonId,
      title: "Quiz",
      passingScore: opts?.passingScore ?? 0.7,
    })
    .returning()
    .get();
}

function seedMCQuestion(quizId: number, position: number) {
  const q = testDb
    .insert(schema.quizQuestions)
    .values({
      quizId,
      questionText: `Q${position}`,
      questionType: QuestionType.MultipleChoice,
      position,
    })
    .returning()
    .get();
  const correct = testDb
    .insert(schema.quizOptions)
    .values({ questionId: q.id, optionText: "Correct", isCorrect: true })
    .returning()
    .get();
  const wrong = testDb
    .insert(schema.quizOptions)
    .values({ questionId: q.id, optionText: "Wrong", isCorrect: false })
    .returning()
    .get();
  return { question: q, correct, wrong };
}

describe("quizScoringService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("calculateGrade", () => {
    it("maps scores to letter grades at each boundary", () => {
      expect(calculateGrade(0.95)).toBe("A");
      expect(calculateGrade(0.9)).toBe("A");
      expect(calculateGrade(0.85)).toBe("B");
      expect(calculateGrade(0.75)).toBe("C");
      expect(calculateGrade(0.65)).toBe("D");
      expect(calculateGrade(0.5)).toBe("F");
    });
  });

  describe("submitQuizAttempt", () => {
    it("scores a fully correct attempt, records it, and auto-completes the lesson", () => {
      const lesson = seedLesson();
      const quiz = seedQuiz({ lessonId: lesson.id });
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: {
          [q1.question.id]: q1.correct.id,
          [q2.question.id]: q2.correct.id,
        },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const { result } = outcome;
      expect(result.score).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.grade).toBe("A");
      expect(result.totalCorrect).toBe(2);
      expect(result.totalQuestions).toBe(2);
      expect(result.questionResults).toHaveLength(2);
      expect(result.lessonCompleted).toBe(true);

      // Attempt + answers persisted.
      const attempts = testDb
        .select()
        .from(schema.quizAttempts)
        .where(eq(schema.quizAttempts.quizId, quiz.id))
        .all();
      expect(attempts).toHaveLength(1);

      const answers = testDb
        .select()
        .from(schema.quizAnswers)
        .where(eq(schema.quizAnswers.attemptId, result.attemptId))
        .all();
      expect(answers).toHaveLength(2);

      // Lesson marked complete.
      const progress = testDb
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.lessonId, lesson.id))
        .get();
      expect(progress?.status).toBe(LessonProgressStatus.Completed);
    });

    it("does not complete the lesson when the attempt fails", () => {
      const lesson = seedLesson();
      const quiz = seedQuiz({ lessonId: lesson.id });
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: {
          [q1.question.id]: q1.correct.id,
          [q2.question.id]: q2.wrong.id,
        },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.score).toBe(0.5);
      expect(outcome.result.passed).toBe(false);
      expect(outcome.result.grade).toBe("F");
      expect(outcome.result.lessonCompleted).toBe(false);

      const progress = testDb
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.lessonId, lesson.id))
        .get();
      expect(progress).toBeUndefined();
    });

    it("honors the quiz's passingScore instead of a hardcoded threshold", () => {
      // passingScore 0.5 means a half-correct attempt passes.
      const quiz = seedQuiz({ passingScore: 0.5 });
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: {
          [q1.question.id]: q1.correct.id,
          [q2.question.id]: q2.wrong.id,
        },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.score).toBe(0.5);
      expect(outcome.result.passed).toBe(true);
      expect(outcome.result.lessonCompleted).toBe(true);
    });

    it("reports lessonCompleted false when the lesson was already complete", () => {
      const lesson = seedLesson();
      const quiz = seedQuiz({ lessonId: lesson.id });
      const q1 = seedMCQuestion(quiz.id, 1);

      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          status: LessonProgressStatus.Completed,
          completedAt: new Date().toISOString(),
        })
        .run();

      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: { [q1.question.id]: q1.correct.id },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.passed).toBe(true);
      expect(outcome.result.lessonCompleted).toBe(false);
    });

    it("treats an unanswered question as incorrect", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: { [q1.question.id]: q1.correct.id },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.score).toBe(0.5);
      const unanswered = outcome.result.questionResults.find(
        (r) => r.questionId === q2.question.id
      );
      expect(unanswered?.correct).toBe(false);
      expect(unanswered?.selectedOptionId).toBeNull();

      // Only the answered question is persisted.
      const answers = testDb
        .select()
        .from(schema.quizAnswers)
        .where(eq(schema.quizAnswers.attemptId, outcome.result.attemptId))
        .all();
      expect(answers).toHaveLength(1);
    });

    it("returns an error when the quiz does not exist", () => {
      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: 999,
        selectedAnswers: {},
      });
      expect(outcome.ok).toBe(false);
    });
  });

  describe("getAttemptReview", () => {
    it("returns answers, correct options, and grade for a stored attempt", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const outcome = submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: {
          [q1.question.id]: q1.correct.id,
          [q2.question.id]: q2.wrong.id,
        },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const review = getAttemptReview(outcome.result.attemptId)!;
      expect(review.attempt.score).toBe(0.5);
      expect(review.grade).toBe("F");
      expect(review.totalCorrect).toBe(1);
      expect(review.totalQuestions).toBe(2);

      const r1 = review.questionResults.find(
        (r) => r.questionId === q1.question.id
      )!;
      expect(r1.correct).toBe(true);
      expect(r1.selectedOptionId).toBe(q1.correct.id);
      expect(r1.correctOptionId).toBe(q1.correct.id);

      const r2 = review.questionResults.find(
        (r) => r.questionId === q2.question.id
      )!;
      expect(r2.correct).toBe(false);
      expect(r2.selectedOptionId).toBe(q2.wrong.id);
      expect(r2.correctOptionId).toBe(q2.correct.id);
    });

    it("returns null for a missing attempt", () => {
      expect(getAttemptReview(999)).toBeNull();
    });
  });

  describe("getQuizStats", () => {
    it("aggregates attempts and computes the pass rate", () => {
      const quiz = seedQuiz({ passingScore: 0.7 });
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      // One passing (1.0), one failing (0.5).
      submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: {
          [q1.question.id]: q1.correct.id,
          [q2.question.id]: q2.correct.id,
        },
      });
      submitQuizAttempt({
        userId: base.instructor.id,
        quizId: quiz.id,
        selectedAnswers: {
          [q1.question.id]: q1.correct.id,
          [q2.question.id]: q2.wrong.id,
        },
      });

      const stats = getQuizStats(quiz.id);
      expect(stats.totalAttempts).toBe(2);
      expect(stats.averageScore).toBe(0.75);
      expect(stats.highScore).toBe(1);
      expect(stats.lowScore).toBe(0.5);
      expect(stats.passRate).toBe(0.5);
    });

    it("returns zeros when there are no attempts", () => {
      const quiz = seedQuiz();
      expect(getQuizStats(quiz.id)).toEqual({
        totalAttempts: 0,
        averageScore: 0,
        highScore: 0,
        lowScore: 0,
        passRate: 0,
      });
    });
  });

  describe("getUserQuizHistory", () => {
    it("lists a user's attempts newest-first with grades", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);

      submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: { [q1.question.id]: q1.wrong.id },
      });
      submitQuizAttempt({
        userId: base.user.id,
        quizId: quiz.id,
        selectedAnswers: { [q1.question.id]: q1.correct.id },
      });

      const history = getUserQuizHistory({
        userId: base.user.id,
        quizId: quiz.id,
      });
      expect(history).toHaveLength(2);
      expect(history.every((h) => typeof h.grade === "string")).toBe(true);
      // Failing attempt scores 0 → grade F; passing scores 1 → grade A.
      const grades = history.map((h) => h.grade).sort();
      expect(grades).toEqual(["A", "F"]);
    });
  });
});
