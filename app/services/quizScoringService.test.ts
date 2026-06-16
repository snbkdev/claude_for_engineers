import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// NOTE: getQuizStats / getUserQuizHistory are intentionally not tested here —
// they read through a separate raw better-sqlite3 connection to the real
// data.db opened at import time, so the ~/db mock can't isolate them.
import {
  getScore,
  computeResult,
  calculateGrade,
  renderQuizResults,
} from "./quizScoringService";

function seedQuiz() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 0 })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 0 })
    .returning()
    .get();
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
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

  describe("renderQuizResults", () => {
    it("computes percentage, grade and a passing message", () => {
      const result = renderQuizResults({ score: 8, total: 10, passed: true, showAnswers: true, showExplanations: false });
      expect(result.percentage).toBe(0.8);
      expect(result.grade).toBe("B");
      expect(result.passed).toBe(true);
      expect(result.message).toMatch(/passed/i);
      expect(result.showAnswers).toBe(true);
      expect(result.showExplanations).toBeUndefined();
    });

    it("returns a failing message when not passed", () => {
      const result = renderQuizResults({ score: 3, total: 10, passed: false, showAnswers: false, showExplanations: false });
      expect(result.passed).toBe(false);
      expect(result.message).toMatch(/did not pass/i);
    });
  });

  describe("getScore", () => {
    it("scores a fully correct attempt as passing with grade A", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const result = getScore({ quizId: quiz.id, answers: [
        { questionId: q1.question.id, selectedOptionId: q1.correct.id },
        { questionId: q2.question.id, selectedOptionId: q2.correct.id },
      ] });

      expect(result.totalCorrect).toBe(2);
      expect(result.totalQuestions).toBe(2);
      expect(result.score).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.grade).toBe("A");
    });

    it("does not pass at exactly 0.5 (threshold is > 0.7)", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const result = getScore({ quizId: quiz.id, answers: [
        { questionId: q1.question.id, selectedOptionId: q1.correct.id },
        { questionId: q2.question.id, selectedOptionId: q2.wrong.id },
      ] });

      expect(result.score).toBe(0.5);
      expect(result.passed).toBe(false);
      expect(result.grade).toBe("F");
    });

    it("returns a failing default when the quiz is missing", () => {
      const result = getScore({ quizId: 999, answers: [] });
      expect(result).toEqual({ score: 0, passed: false, grade: "F" });
    });
  });

  describe("computeResult", () => {
    it("records an attempt with answers and returns per-question results", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const result = computeResult({ userId: base.user.id, quizId: quiz.id, selectedAnswers: {
        [q1.question.id]: q1.correct.id,
        [q2.question.id]: q2.correct.id,
      } })!;

      expect(result.attemptId).toBeDefined();
      expect(result.score).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.grade).toBe("A");
      expect(result.totalCorrect).toBe(2);
      expect(result.questionResults).toHaveLength(2);

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
    });

    it("treats an unanswered question as incorrect", () => {
      const quiz = seedQuiz();
      const q1 = seedMCQuestion(quiz.id, 1);
      const q2 = seedMCQuestion(quiz.id, 2);

      const result = computeResult({ userId: base.user.id, quizId: quiz.id, selectedAnswers: {
        [q1.question.id]: q1.correct.id,
      } })!;

      expect(result.score).toBe(0.5);
      expect(result.passed).toBe(false);
      const unanswered = result.questionResults.find(
        (r: any) => r.questionId === q2.question.id
      );
      expect(unanswered.correct).toBe(false);
      expect(unanswered.selectedOptionId).toBeNull();
    });

    it("returns null when the quiz does not exist", () => {
      expect(computeResult({ userId: base.user.id, quizId: 999, selectedAnswers: {} })).toBeNull();
    });
  });
});
