import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  logWatchEvent,
  getWatchEvents,
  getLastWatchPosition,
  getWatchEventCount,
  getMaxWatchPosition,
  calculateWatchProgress,
  hasUserWatchedVideo,
  hasUserCompletedVideo,
  getUserWatchHistory,
  deleteWatchEvents,
  isVideoComplete,
  VIDEO_COMPLETION_THRESHOLD,
} from "./videoTrackingService";

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

// Inserts an event with an explicit timestamp so ordering is deterministic.
function seedEvent(
  userId: number,
  lessonId: number,
  positionSeconds: number,
  createdAt: string
) {
  return testDb
    .insert(schema.videoWatchEvents)
    .values({
      userId,
      lessonId,
      eventType: "progress",
      positionSeconds,
      createdAt,
    })
    .returning()
    .get();
}

describe("videoTrackingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("logWatchEvent + reads", () => {
    it("logs an event and counts it", () => {
      const lesson = seedLesson();
      logWatchEvent({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "play",
        positionSeconds: 0,
      });
      logWatchEvent({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 30,
      });

      expect(
        getWatchEventCount({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(2);
      expect(
        getWatchEvents({ userId: base.user.id, lessonId: lesson.id })
      ).toHaveLength(2);
      expect(
        hasUserWatchedVideo({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(true);
    });

    it("reports no watch history for an untouched lesson", () => {
      const lesson = seedLesson();
      expect(
        getWatchEventCount({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(0);
      expect(
        hasUserWatchedVideo({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(false);
      expect(
        getLastWatchPosition({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(0);
      expect(
        getMaxWatchPosition({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(0);
    });
  });

  describe("positions", () => {
    it("getLastWatchPosition returns the most recent event's position", () => {
      const lesson = seedLesson();
      seedEvent(base.user.id, lesson.id, 120, "2024-01-01T00:00:00.000Z");
      seedEvent(base.user.id, lesson.id, 45, "2024-01-02T00:00:00.000Z");

      // Latest by createdAt is the 45s event, even though it's a lower position.
      expect(
        getLastWatchPosition({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(45);
    });

    it("getMaxWatchPosition returns the furthest position reached", () => {
      const lesson = seedLesson();
      seedEvent(base.user.id, lesson.id, 120, "2024-01-01T00:00:00.000Z");
      seedEvent(base.user.id, lesson.id, 45, "2024-01-02T00:00:00.000Z");

      expect(
        getMaxWatchPosition({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(120);
    });
  });

  describe("calculateWatchProgress", () => {
    it("returns 0 for non-positive duration", () => {
      const lesson = seedLesson();
      expect(
        calculateWatchProgress({
          userId: base.user.id,
          lessonId: lesson.id,
          videoDurationSeconds: 0,
        })
      ).toBe(0);
    });

    it("computes rounded percentage capped at 100", () => {
      const lesson = seedLesson();
      seedEvent(base.user.id, lesson.id, 75, "2024-01-01T00:00:00.000Z");
      expect(
        calculateWatchProgress({
          userId: base.user.id,
          lessonId: lesson.id,
          videoDurationSeconds: 100,
        })
      ).toBe(75);
    });

    it("caps progress at 100 when position exceeds duration", () => {
      const lesson = seedLesson();
      seedEvent(base.user.id, lesson.id, 200, "2024-01-01T00:00:00.000Z");
      expect(
        calculateWatchProgress({
          userId: base.user.id,
          lessonId: lesson.id,
          videoDurationSeconds: 100,
        })
      ).toBe(100);
    });
  });

  describe("hasUserCompletedVideo", () => {
    it("is true once progress meets the threshold", () => {
      const lesson = seedLesson();
      seedEvent(base.user.id, lesson.id, 90, "2024-01-01T00:00:00.000Z");

      expect(
        hasUserCompletedVideo({
          userId: base.user.id,
          lessonId: lesson.id,
          videoDurationSeconds: 100,
          completionThreshold: 90,
        })
      ).toBe(true);
      expect(
        hasUserCompletedVideo({
          userId: base.user.id,
          lessonId: lesson.id,
          videoDurationSeconds: 100,
          completionThreshold: 95,
        })
      ).toBe(false);
    });
  });

  describe("getUserWatchHistory + deleteWatchEvents", () => {
    it("aggregates per lesson for a user", () => {
      const lessonA = seedLesson();
      const lessonB = seedLesson();
      seedEvent(base.user.id, lessonA.id, 10, "2024-01-01T00:00:00.000Z");
      seedEvent(base.user.id, lessonA.id, 60, "2024-01-02T00:00:00.000Z");
      seedEvent(base.user.id, lessonB.id, 5, "2024-01-01T00:00:00.000Z");

      const history = getUserWatchHistory(base.user.id);
      expect(history).toHaveLength(2);

      const a = history.find((h) => h.lessonId === lessonA.id)!;
      expect(a.eventCount).toBe(2);
      expect(a.lastPosition).toBe(60);
    });

    it("deleteWatchEvents removes a lesson's events", () => {
      const lesson = seedLesson();
      logWatchEvent({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "play",
        positionSeconds: 0,
      });
      logWatchEvent({
        userId: base.user.id,
        lessonId: lesson.id,
        eventType: "progress",
        positionSeconds: 30,
      });

      const deleted = deleteWatchEvents({
        userId: base.user.id,
        lessonId: lesson.id,
      });
      expect(deleted).toHaveLength(2);
      expect(
        getWatchEventCount({ userId: base.user.id, lessonId: lesson.id })
      ).toBe(0);
    });
  });

  describe("isVideoComplete", () => {
    it("completes at or above the threshold", () => {
      expect(
        isVideoComplete({
          progress: VIDEO_COMPLETION_THRESHOLD,
          eventType: "progress",
        })
      ).toBe(true);
      expect(isVideoComplete({ progress: 100, eventType: "progress" })).toBe(
        true
      );
    });

    it("does not complete below the threshold", () => {
      expect(
        isVideoComplete({
          progress: VIDEO_COMPLETION_THRESHOLD - 1,
          eventType: "progress",
        })
      ).toBe(false);
    });

    it("always completes on the ended event regardless of progress", () => {
      expect(isVideoComplete({ progress: 0, eventType: "ended" })).toBe(true);
    });
  });
});
