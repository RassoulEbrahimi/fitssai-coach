/**
 * Unsaved text in the actual-performance inputs of a running workout.
 *
 * A draft is what the user is typing; nothing here is persisted. The store is
 * owned above Focus Mode's portal (see `useWorkoutExecution`), so entering or
 * leaving fullscreen - which remounts every row - keeps half-typed values, and
 * the card can commit every draft before the finish summary opens.
 *
 * Rows subscribe to their own set key, so a keystroke re-renders one row.
 */

export type SetPerformanceField = "reps" | "weight";

export interface SetPerformanceDraft {
  reps?: string;
  weight?: string;
  /** Why the last commit refused `reps`. Cleared as soon as the text changes. */
  repsError?: string;
  weightError?: string;
}

export type SetPerformanceCommit = "unchanged" | "saved" | "invalid";

export interface InvalidSetPerformanceField {
  exerciseIndex: number;
  setNumber: number;
  field: SetPerformanceField;
}

export const setPerformanceKey = (exerciseIndex: number, setNumber: number): string =>
  `${exerciseIndex}:${setNumber}`;

export const setPerformanceFieldId = (
  exerciseIndex: number,
  setNumber: number,
  field: SetPerformanceField
): string => `set-performance-${exerciseIndex}-${setNumber}-${field}`;

const DRAFT_FIELDS = ["reps", "weight", "repsError", "weightError"] as const;

export class SetPerformanceDraftStore {
  private readonly drafts = new Map<string, SetPerformanceDraft>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Stable per version, as `useSyncExternalStore` requires. */
  get = (key: string): SetPerformanceDraft | undefined => this.drafts.get(key);

  keys = (): string[] => [...this.drafts.keys()];

  /** Replaces a set's draft; a draft with nothing left in it is removed. */
  set = (key: string, draft: SetPerformanceDraft): void => {
    const next: SetPerformanceDraft = {};
    for (const field of DRAFT_FIELDS) {
      if (draft[field] !== undefined) next[field] = draft[field];
    }
    if (Object.keys(next).length === 0) {
      if (!this.drafts.delete(key)) return;
    } else {
      this.drafts.set(key, next);
    }
    this.listeners.forEach((listener) => listener());
  };
}

/** What a set row needs to edit its actual performance. */
export interface SetPerformanceInputs {
  drafts: SetPerformanceDraftStore;
  changeDraft: (exerciseIndex: number, setNumber: number, field: SetPerformanceField, text: string) => void;
  /** Validates and persists the set's draft. Never touches completion or rest. */
  commit: (exerciseIndex: number, setNumber: number) => SetPerformanceCommit;
}
