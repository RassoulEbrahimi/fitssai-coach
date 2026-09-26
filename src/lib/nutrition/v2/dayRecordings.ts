import { isActiveRecordedEntry, slotEntryId, type NutritionDate, type RecordedEntry } from "@shared/nutrition";
import type { ResolvedNutritionDay, ResolvedNutritionMeal } from "./resolvedPlan";

/**
 * One date's slots next to what was explicitly recorded for them. Pure: no
 * Firestore, React or clock.
 *
 * PLANNED and RECORDED stay apart: `meal` is the resolved planned meal, and
 * `active` is the recorded estimate snapshot, if any. Nothing here copies a
 * planned value into a recording or a recorded value into the plan.
 */

export interface NutritionSlotRecording {
  /** What the plan proposes for the slot. Planned, not eaten. */
  meal: ResolvedNutritionMeal;
  /** `slot:{date}:{slotId}` — the slot's one entry id. */
  entryId: string;
  /**
   * The slot's entry document, active or a `removed` tombstone; `null` when
   * the slot was never recorded. Its revision is what the next write names.
   */
  entry: RecordedEntry | null;
  /** The entry when it counts as a recording; `null` for none or a tombstone. */
  active: RecordedEntry | null;
}

export interface NutritionDayRecordings {
  date: NutritionDate;
  /** One per resolved meal, in the plan's slot order. */
  slots: NutritionSlotRecording[];
  /** Active extra entries of the date, ordered by entry id. Tombstones are left out. */
  extras: RecordedEntry[];
}

export const buildNutritionDayRecordings = (
  day: ResolvedNutritionDay,
  entries: readonly RecordedEntry[]
): NutritionDayRecordings => {
  const onDate = entries.filter((entry) => entry.date === day.date);
  const byId = new Map(onDate.filter((entry) => entry.kind === "slot").map((entry) => [entry.entryId, entry]));

  const slots = day.meals.map((meal): NutritionSlotRecording => {
    const entryId = slotEntryId(day.date, meal.slotId);
    const entry = byId.get(entryId) ?? null;
    return { meal, entryId, entry, active: entry && isActiveRecordedEntry(entry) ? entry : null };
  });

  const extras = onDate
    .filter((entry) => entry.kind === "extra" && isActiveRecordedEntry(entry))
    .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));

  return { date: day.date, slots, extras };
};
