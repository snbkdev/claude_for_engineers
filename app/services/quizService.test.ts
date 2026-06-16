import { describe, it, expect, beforeEach, vi } from "vitest";
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

import {
  getQuizById,
  getQuizByLessonId,
  getQuizWithQuestions,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  getQuestionsByQuiz,
  getQuestionCount,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  moveQuestionToPosition,
  reorderQuestions,
  createOption,
  getOptionsByQuestion,
  recordAttempt,
  getAttemptsByUser,
  getAttemptCountForQuiz,
  getBestAttempt,
  getLatestAttempt,
  recordAnswer,
  getAttemptWithAnswers,
} from "./quizService";

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

function seedQuiz(passingScore = 0.7) {
  const lesson = seedLesson();
  return createQuiz({ lessonId: lesson.id, title: "Quiz 1", passingScore });
}

describe("quizService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("quiz CRUD", () => {
    it("creates and looks up a quiz by id and lesson", () => {
      const lesson = seedLesson();
      const quiz = createQuiz({ lessonId: lesson.id, title: "TS Basics", passingScore: 0.8 });

      expect(getQuizById(quiz.id)?.title).toBe("TS Basics");
      expect(getQuizByLessonId(lesson.id)?.id).toBe(quiz.id);
    });

    it("updateQuiz only changes provided fields", () => {
      const quiz = seedQuiz(0.7);
      const updated = updateQuiz(quiz.id, "New Title", null);
      expect(updated?.title).toBe("New Title");
      expect(updated?.passingScore).toBe(0.7);
    });

    it("getQuizWithQuestions nests options under questions in order", () => {
      const quiz = seedQuiz();
      const q1 = createQuestion(
        quiz.id,
        "Q1",
        QuestionType.MultipleChoice,
        null
      );
      createOption(q1.id, "A", true);
      createOption(q1.id, "B", false);
      createQuestion(quiz.id, "Q2", QuestionType.TrueFalse, null);

      const full = getQuizWithQuestions(quiz.id)!;
      expect(full.questions).toHaveLength(2);
      expect(full.questions[0].questionText).toBe("Q1");
      expect(full.questions[0].options).toHaveLength(2);
      expect(full.questions[1].options).toHaveLength(0);
    });

    it("getQuizWithQuestions returns null for a missing quiz", () => {
      expect(getQuizWithQuestions(999)).toBeNull();
    });

    it("deleteQuiz cascades questions, options, attempts and answers", () => {
      const quiz = seedQuiz();
      const q = createQuestion(
        quiz.id,
        "Q1",
        QuestionType.MultipleChoice,
        null
      );
      const opt = createOption(q.id, "A", true);
      const attempt = recordAttempt({ userId: base.user.id, quizId: quiz.id, score: 1, passed: true });
      recordAnswer({ attemptId: attempt.id, questionId: q.id, selectedOptionId: opt.id });

      deleteQuiz(quiz.id);

      expect(getQuizById(quiz.id)).toBeUndefined();
      expect(getQuestionsByQuiz(quiz.id)).toHaveLength(0);
      expect(getOptionsByQuestion(q.id)).toHaveLength(0);
      expect(getAttemptCountForQuiz(quiz.id)).toBe(0);
      expect(getAttemptWithAnswers(attempt.id)).toBeNull();
    });
  });

  describe("questions", () => {
    it("auto-increments position when none is given", () => {
      const quiz = seedQuiz();
      const q1 = createQuestion(quiz.id, "Q1", QuestionType.TrueFalse, null);
      const q2 = createQuestion(quiz.id, "Q2", QuestionType.TrueFalse, null);

      expect(q1.position).toBe(1);
      expect(q2.position).toBe(2);
      expect(getQuestionCount(quiz.id)).toBe(2);
    });

    it("updateQuestion changes only provided fields", () => {
      const quiz = seedQuiz();
      const q = createQuestion(quiz.id, "Old", QuestionType.TrueFalse, null);
      const updated = updateQuestion(q.id, "New text", null);
      expect(updated?.questionText).toBe("New text");
      expect(updated?.questionType).toBe(QuestionType.TrueFalse);
    });

    it("deleteQuestion removes its options too", () => {
      const quiz = seedQuiz();
      const q = createQuestion(
        quiz.id,
        "Q",
        QuestionType.MultipleChoice,
        null
      );
      createOption(q.id, "A", true);

      deleteQuestion(q.id);
      expect(getOptionsByQuestion(q.id)).toHaveLength(0);
      expect(getQuestionCount(quiz.id)).toBe(0);
    });
  });

  describe("reordering", () => {
    it("moveQuestionToPosition shifts the questions in between", () => {
      const quiz = seedQuiz();
      const q1 = createQuestion(quiz.id, "Q1", QuestionType.TrueFalse, null);
      const q2 = createQuestion(quiz.id, "Q2", QuestionType.TrueFalse, null);
      const q3 = createQuestion(quiz.id, "Q3", QuestionType.TrueFalse, null);

      // Move Q1 (pos 1) to pos 3 → Q2,Q3 shift down, Q1 last.
      moveQuestionToPosition({ questionId: q1.id, newPosition: 3 });

      const ordered = getQuestionsByQuiz(quiz.id).map((q) => q.id);
      expect(ordered).toEqual([q2.id, q3.id, q1.id]);
    });

    it("reorderQuestions applies an explicit order", () => {
      const quiz = seedQuiz();
      const q1 = createQuestion(quiz.id, "Q1", QuestionType.TrueFalse, null);
      const q2 = createQuestion(quiz.id, "Q2", QuestionType.TrueFalse, null);
      const q3 = createQuestion(quiz.id, "Q3", QuestionType.TrueFalse, null);

      reorderQuestions(quiz.id, [q3.id, q1.id, q2.id]);

      const ordered = getQuestionsByQuiz(quiz.id).map((q) => q.id);
      expect(ordered).toEqual([q3.id, q1.id, q2.id]);
    });
  });

  describe("attempts", () => {
    it("records attempts and finds the highest-scoring one", () => {
      const quiz = seedQuiz();
      recordAttempt({ userId: base.user.id, quizId: quiz.id, score: 0.4, passed: false });
      recordAttempt({ userId: base.user.id, quizId: quiz.id, score: 0.9, passed: true });
      recordAttempt({ userId: base.user.id, quizId: quiz.id, score: 0.6, passed: false });

      expect(getAttemptsByUser({ userId: base.user.id, quizId: quiz.id })).toHaveLength(3);
      expect(getAttemptCountForQuiz(quiz.id)).toBe(3);
      expect(getBestAttempt({ userId: base.user.id, quizId: quiz.id })?.score).toBe(0.9);
    });

    it("getLatestAttempt returns the most recent attempt by time", () => {
      const quiz = seedQuiz();
      // Explicit timestamps keep ordering deterministic (recordAttempt would
      // otherwise stamp all rows within the same millisecond).
      testDb
        .insert(schema.quizAttempts)
        .values({
          userId: base.user.id,
          quizId: quiz.id,
          score: 0.5,
          passed: false,
          attemptedAt: "2024-01-01T00:00:00.000Z",
        })
        .run();
      const newer = testDb
        .insert(schema.quizAttempts)
        .values({
          userId: base.user.id,
          quizId: quiz.id,
          score: 0.8,
          passed: true,
          attemptedAt: "2024-01-02T00:00:00.000Z",
        })
        .returning()
        .get();

      expect(getLatestAttempt({ userId: base.user.id, quizId: quiz.id })?.id).toBe(newer.id);
    });

    it("getAttemptWithAnswers bundles the recorded answers", () => {
      const quiz = seedQuiz();
      const q = createQuestion(
        quiz.id,
        "Q",
        QuestionType.MultipleChoice,
        null
      );
      const opt = createOption(q.id, "A", true);
      const attempt = recordAttempt({ userId: base.user.id, quizId: quiz.id, score: 1, passed: true });
      recordAnswer({ attemptId: attempt.id, questionId: q.id, selectedOptionId: opt.id });

      const bundle = getAttemptWithAnswers(attempt.id)!;
      expect(bundle.answers).toHaveLength(1);
      expect(bundle.answers[0].selectedOptionId).toBe(opt.id);
    });
  });
});
