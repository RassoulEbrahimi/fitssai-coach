import {
  NUTRITION_SCHEMA_VERSION,
  extraEntryId,
  isActiveRecordedEntry,
  isNutritionDate,
  recordedEntrySnapshotSchema,
  slotEntryId,
  type NutritionDate,
  type NutritionEntryIntent,
  type NutritionEntryOp,
  type NutritionEstimate,
  type NutritionSlotId,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "@shared/nutrition";
import type { ResolvedNutritionMeal } from "./resolvedPlan";

/**
 * Builders for what an explicit recording action asks for. Pure: no
 * Firestore, React, clock or randomness — the extra entry's UUID and the
 * intent id are passed in by the caller.
 *
 * A builder returns the full desired snapshot (`RecordedEntrySnapshot`). It is
 * built once, when the person confirms, from what they were shown — the plan
 * is never looked up again afterwards, so the snapshot keeps meaning what was
 * confirmed even if the plan or the slot's override changes later.
 *
 * Structural validation only: no calorie floor or ceiling, no macro target,
 * no portion range beyond "a finite number above zero".
 */

/** Convenience presets for the portion picker. Not a domain: any finite portion above zero is valid. */
export const NUTRITION_PORTION_PRESETS = [0.5, 0.75, 1, 1.5] as const;

/** A recording input that cannot become a valid snapshot. */
export class NutritionRecordingInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "NutritionRecordingInputError";
  }
}

const requirePortion = (portion: unknown): number => {
  if (typeof portion !== "number" || !Number.isFinite(portion) || portion <= 0) {
    throw new NutritionRecordingInputError("portion must be a finite number greater than zero");
  }
  return portion;
};

const requireQuantity = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new NutritionRecordingInputError(`${label} must be a finite number that is not negative`);
  }
  return value;
};

/** `null` and `undefined` both mean "not stated": unknown, never zero. */
const optionalQuantity = (value: unknown, label: string): number | null =>
  value === null || value === undefined ? null : requireQuantity(value, label);

const requireName = (name: unknown): string => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0) throw new NutritionRecordingInputError("a name is required");
  return trimmed;
};

const snapshot = (value: unknown): RecordedEntrySnapshot => {
  const parsed = recordedEntrySnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new NutritionRecordingInputError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
};

/** What the person states for a custom meal: kcal required, each macro a number or unknown. */
export interface NutritionEstimateInput {
  kcal: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

const userStatedEstimate = (input: NutritionEstimateInput): NutritionEstimate => {
  if (input === null || typeof input !== "object") throw new NutritionRecordingInputError("an estimate is required");
  return {
    kcal: requireQuantity(input.kcal, "kcal"),
    proteinG: optionalQuantity(input.proteinG, "proteinG"),
    carbsG: optionalQuantity(input.carbsG, "carbsG"),
    fatG: optionalQuantity(input.fatG, "fatG"),
  };
};

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

/**
 * The resolved planned meal (base or override) was eaten, in `portion`.
 *
 * The estimate is the resolved meal's planned values times the portion,
 * computed once here and stored unrounded; presentation rounds.
 */
export const buildPlannedMealRecording = (meal: ResolvedNutritionMeal, portion: number): RecordedEntrySnapshot => {
  const factor = requirePortion(portion);
  const { kcal, proteinG, carbsG, fatG } = meal.values;
  return snapshot({
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    entryId: slotEntryId(meal.date, meal.slotId),
    kind: "slot",
    date: meal.date,
    slotId: meal.slotId,
    recording: "plannedMeal",
    planId: meal.planId,
    name: meal.name,
    estimateBasis: "planMealTimesPortion",
    portion: factor,
    nutritionEstimate: { kcal: kcal * factor, proteinG: proteinG * factor, carbsG: carbsG * factor, fatG: fatG * factor },
  });
};

/** The slot was explicitly skipped: no meal, no estimate. */
export const buildSkipRecording = ({ date, slotId }: { date: NutritionDate; slotId: NutritionSlotId }): RecordedEntrySnapshot =>
  snapshot({
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    entryId: slotEntryId(date, slotId),
    kind: "slot",
    date,
    slotId,
    recording: "skip",
    estimateBasis: "none",
    nutritionEstimate: null,
  });

/** Something other than the planned meal was eaten in the slot. */
export const buildCustomSlotRecording = ({
  date,
  slotId,
  name,
  estimate,
}: {
  date: NutritionDate;
  slotId: NutritionSlotId;
  name: string;
  estimate: NutritionEstimateInput;
}): RecordedEntrySnapshot =>
  snapshot({
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    entryId: slotEntryId(date, slotId),
    kind: "slot",
    date,
    slotId,
    recording: "custom",
    name: requireName(name),
    estimateBasis: "userStated",
    nutritionEstimate: userStatedEstimate(estimate),
  });

/**
 * A meal outside the day's slots. Its identity is `extra:{uuid}` from the
 * caller's UUID — never derived from the name.
 */
export const buildExtraRecording = ({
  uuid,
  date,
  name,
  estimate,
}: {
  uuid: string;
  date: NutritionDate;
  name: string;
  estimate: NutritionEstimateInput;
}): RecordedEntrySnapshot =>
  snapshot({
    schemaVersion: NUTRITION_SCHEMA_VERSION,
    entryId: extraEntryId(uuid),
    kind: "extra",
    date,
    slotId: null,
    recording: "custom",
    name: requireName(name),
    estimateBasis: "userStated",
    nutritionEstimate: userStatedEstimate(estimate),
  });

/* ------------------------------------------------------------------ *
 * Commands and intents
 * ------------------------------------------------------------------ */

/**
 * One explicit recording action, against the entry the person was looking at
 * (`current`: the document, active or tombstoned, or `null` if none).
 */
export type NutritionRecordingCommand =
  | { kind: "save"; current: RecordedEntry | null; desired: RecordedEntrySnapshot }
  | { kind: "remove"; current: RecordedEntry };

/** Correct an active entry; otherwise record (or skip) — also over a tombstone. */
export const nutritionEntryOpFor = (
  current: RecordedEntry | null,
  desired: RecordedEntrySnapshot
): Exclude<NutritionEntryOp, "remove"> => {
  if (current !== null && isActiveRecordedEntry(current)) return "correct";
  return desired.recording === "skip" ? "skip" : "record";
};

/** The date a command writes to. */
export const nutritionRecordingCommandDate = (command: NutritionRecordingCommand): NutritionDate =>
  command.kind === "save" ? command.desired.date : command.current.date;

/**
 * The intent for `command`, naming the revision the person saw. `intentId` is
 * created by the caller once per action and reused for every retry of it.
 */
export const buildNutritionEntryIntent = (command: NutritionRecordingCommand, intentId: string): NutritionEntryIntent => {
  if (command.kind === "remove") {
    return {
      intentId,
      entryId: command.current.entryId,
      expectedRevision: command.current.revision,
      op: "remove",
    };
  }
  const { current, desired } = command;
  if (current !== null && current.entryId !== desired.entryId) {
    throw new NutritionRecordingInputError("the current entry is not the entry being recorded");
  }
  return {
    intentId,
    entryId: desired.entryId,
    expectedRevision: current?.revision ?? 0,
    op: nutritionEntryOpFor(current, desired),
    desired,
  };
};

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * Whether `date` may be recorded, given today's Berlin date: never a future
 * date. There is deliberately no lower bound — how far back a person may
 * backfill is an unresolved product decision, so nothing here invents one.
 */
export const isRecordableNutritionDate = (date: unknown, today: NutritionDate): boolean =>
  isNutritionDate(date) && isNutritionDate(today) && date <= today;

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

const DECIMAL_INPUT = /^\d+(?:[.,]\d+)?$/;

/**
 * A number typed into a form: digits with an optional `,` or `.` decimal
 * part. Empty text is `null` (not stated) — never zero. Anything else is
 * invalid.
 */
export const parseNutritionNumberInput = (text: string): { valid: true; value: number | null } | { valid: false } => {
  const trimmed = text.trim();
  if (trimmed === "") return { valid: true, value: null };
  if (!DECIMAL_INPUT.test(trimmed)) return { valid: false };
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? { valid: true, value } : { valid: false };
};
