// ─── Drip (sequential lesson unlocking) ───
// Pure helpers (no DB) deciding which lessons are unlocked when a course has
// `sequentialUnlock` on. Rule: a lesson is unlocked iff every strictly-earlier
// lesson (in curriculum order: module order, then lesson position) is completed.
// In other words, the unlocked lessons are the contiguous prefix up to AND
// INCLUDING the first not-yet-completed lesson — the first incomplete lesson
// must stay accessible so it can be completed.

/**
 * Given lesson ids already in curriculum order and the set of completed lesson
 * ids, return the set of unlocked lesson ids. Lessons stay unlocked once their
 * prerequisites are met, and the first incomplete lesson is always included.
 */
export function computeUnlockedLessonIds(
  orderedLessonIds: number[],
  completedLessonIds: Set<number>
): Set<number> {
  const unlocked = new Set<number>();
  for (const id of orderedLessonIds) {
    unlocked.add(id); // this lesson is reachable
    if (!completedLessonIds.has(id)) {
      // first incomplete lesson is the furthest the learner can go
      break;
    }
  }
  return unlocked;
}

/**
 * Whether a single lesson is unlocked given the ordered curriculum and the set
 * of completed lessons. Unknown lessons (not in the order) are treated as locked.
 */
export function isLessonUnlocked(
  lessonId: number,
  orderedLessonIds: number[],
  completedLessonIds: Set<number>
): boolean {
  return computeUnlockedLessonIds(orderedLessonIds, completedLessonIds).has(
    lessonId
  );
}
