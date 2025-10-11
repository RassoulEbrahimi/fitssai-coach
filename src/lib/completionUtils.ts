/**
 * Completion State Utilities
 * 
 * Provides type-safe helpers for managing exercise completion state
 * using a flat key-value structure instead of nested maps.
 */

// Flat completion key format: weekKey_dayIndex_exerciseIndex
export type CompletionKey = `${string}_${number}_${number}`;
export type CompletionState = Record<CompletionKey, boolean>;

/**
 * Generate a flat completion key from week, day, and exercise indices
 * 
 * @example
 * getCompletionKey("Week 1", 0, 2) => "Week 1_0_2"
 */
export const getCompletionKey = (
  weekKey: string,
  dayIndex: number,
  exerciseIndex: number
): CompletionKey => `${weekKey}_${dayIndex}_${exerciseIndex}` as CompletionKey;

/**
 * Check if an exercise is completed in the flat completion state
 * 
 * @param state - The flat completion state
 * @param weekKey - Week identifier (e.g., "Week 1")
 * @param dayIndex - Day index (0-6)
 * @param exerciseIndex - Exercise index within the day
 * @returns true if completed, false otherwise
 */
export const isExerciseCompleted = (
  state: CompletionState,
  weekKey: string,
  dayIndex: number,
  exerciseIndex: number
): boolean => {
  const key = getCompletionKey(weekKey, dayIndex, exerciseIndex);
  return state[key] ?? false;
};

/**
 * Set exercise completion status in the flat state
 * Returns a new state object (immutable update)
 * 
 * @param state - Current completion state
 * @param weekKey - Week identifier
 * @param dayIndex - Day index (0-6)
 * @param exerciseIndex - Exercise index
 * @param completed - New completion status
 * @returns New completion state with updated value
 */
export const setExerciseCompletion = (
  state: CompletionState,
  weekKey: string,
  dayIndex: number,
  exerciseIndex: number,
  completed: boolean
): CompletionState => {
  const key = getCompletionKey(weekKey, dayIndex, exerciseIndex);
  return {
    ...state,
    [key]: completed,
  };
};

/**
 * Normalize nested completion map from server to flat structure
 * 
 * Server format: { "0": { "0": true, "1": false }, "1": { ... } }
 * Flat format: { "Week 1_0_0": true, "Week 1_0_1": false, ... }
 * 
 * @param nestedMap - Server response with nested day -> exercise structure
 * @param weekKey - Week identifier to use in flat keys
 * @returns Flat completion state
 */
export const normalizeCompletionMap = (
  nestedMap: Record<string, Record<string, boolean>>,
  weekKey: string
): CompletionState => {
  const flatState: CompletionState = {};

  Object.entries(nestedMap).forEach(([dayKey, exercises]) => {
    const dayIndex = parseInt(dayKey, 10);
    if (isNaN(dayIndex)) return;

    Object.entries(exercises).forEach(([exerciseKey, completed]) => {
      const exerciseIndex = parseInt(exerciseKey, 10);
      if (isNaN(exerciseIndex)) return;

      const key = getCompletionKey(weekKey, dayIndex, exerciseIndex);
      flatState[key] = completed;
    });
  });

  return flatState;
};

/**
 * Get all completed exercises for a specific day
 * Useful for calculating day-level progress
 * 
 * @param state - Flat completion state
 * @param weekKey - Week identifier
 * @param dayIndex - Day index (0-6)
 * @returns Array of completed exercise indices
 */
export const getCompletedExercisesForDay = (
  state: CompletionState,
  weekKey: string,
  dayIndex: number
): number[] => {
  const prefix = `${weekKey}_${dayIndex}_`;
  const completed: number[] = [];

  Object.entries(state).forEach(([key, isCompleted]) => {
    if (isCompleted && key.startsWith(prefix)) {
      const parts = key.split('_');
      const exerciseIndex = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(exerciseIndex)) {
        completed.push(exerciseIndex);
      }
    }
  });

  return completed.sort((a, b) => a - b);
};
