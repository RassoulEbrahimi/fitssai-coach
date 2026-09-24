/**
 * What a stored exercise-position log says about activity by itself.
 *
 * Shared by the plan-edit guard (which protects positions that were trained)
 * and Workout History (which lists only positions that were trained), so the
 * two cannot disagree about what counts. Set documents hang off the parent in
 * a subcollection and are judged separately by each reader.
 *
 * Pure: no Firestore, no React.
 */

const isPositiveNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The exercise itself was ticked off. `completed` is compared to `true`, not
 * coerced; a `completedAt` is only ever written together with a tick.
 */
export const isPositionTicked = (data: Record<string, unknown>): boolean =>
  data.completed === true || (data.completedAt !== undefined && data.completedAt !== null);

/**
 * The parent document records activity on its own: a tick, or a positive
 * duration or calorie figure from older writers. A parent created only to
 * hold sets carries `completed: false` and none of these.
 */
export const hasPositionActivityMarker = (data: Record<string, unknown>): boolean =>
  isPositionTicked(data) ||
  isPositiveNumber(data.durationMinutes) ||
  isPositiveNumber(data.caloriesBurned) ||
  isPositiveNumber(data.durationSec);
