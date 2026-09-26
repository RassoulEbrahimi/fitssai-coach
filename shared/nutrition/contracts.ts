import { z } from "zod";
import { addNutritionDays, isNutritionDate } from "./dates";
import {
  NUTRITION_DOC_ID_PATTERN,
  NUTRITION_SLOT_IDS,
  isExtraEntryId,
  isNutritionSlotId,
  isUuid,
  slotEntryId,
} from "./identity";

/**
 * The Nutrition V2 domain contract, shared by the client and the backend.
 *
 * Three different numbers must never be mistaken for one another:
 *
 *   TARGET            what the person aims for (a `TargetVersion`)
 *   PLANNED           what the plan proposes (`PlannedMeal`, `MealOverride`)
 *   RECORDED ESTIMATE what the person said they ate (`RecordedEntry`)
 *
 * Planned never means consumed: a `RecordedEntry` exists only because the
 * person explicitly recorded it (a planned meal, a skip, or something custom),
 * and its values are an estimate that is
 * snapshotted when it is recorded and never recomputed from the plan again.
 * An active base plan's content is immutable; a change to one day's slot is a
 * date- and slot-scoped `MealOverride`, never an edit of the plan.
 *
 * Data shape only — nothing here reads or writes Firestore, and nothing here
 * encodes a nutrition formula or a quality threshold. Legacy Nutrition
 * (`nutrition_plans`) is not described here and is not read through it.
 *
 * Objects are `.strict()`: these schemas guard trust boundaries, and a field
 * this contract does not name (an `actualCalories`, a micronutrient) is
 * rejected rather than carried along silently.
 */

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Every Nutrition V2 document carries exactly this version. */
export const NUTRITION_SCHEMA_VERSION = 2 as const;

export type NutritionSchemaVersion = typeof NUTRITION_SCHEMA_VERSION;

export const nutritionSchemaVersionSchema = z.literal(NUTRITION_SCHEMA_VERSION);

export const nutritionDateSchema = z
  .string()
  .refine(isNutritionDate, { message: "date must be a calendar date formatted YYYY-MM-DD" });

export const nutritionSlotIdSchema = z.enum(NUTRITION_SLOT_IDS);

export const nutritionDocIdSchema = z.string().regex(NUTRITION_DOC_ID_PATTERN, "invalid id");

/**
 * A finite, non-negative quantity, unrounded. Rounding is presentation.
 */
const quantitySchema = z
  .number({ invalid_type_error: "must be a number" })
  .finite("must be finite")
  .nonnegative("must not be negative");

/**
 * Free text a person reads (a meal name). Must say something; no length cap —
 * a defensive transport limit is a later validation-policy decision, not a
 * layout rule baked into the domain.
 */
const displayTextSchema = z.string().trim().min(1, "must not be empty");

/* ------------------------------------------------------------------ *
 * Nutrition values
 * ------------------------------------------------------------------ */

/** The four canonical nutrients. All known, all non-negative. */
export const nutritionValuesSchema = z
  .object({
    kcal: quantitySchema,
    proteinG: quantitySchema,
    carbsG: quantitySchema,
    fatG: quantitySchema,
  })
  .strict();

export type NutritionValues = z.infer<typeof nutritionValuesSchema>;

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

/**
 * How a target came about: set by the person, or calculated for them. The
 * calculation itself is not part of this contract.
 */
export const NUTRITION_TARGET_MODES = ["manual", "calculated"] as const;

export const nutritionTargetModeSchema = z.enum(NUTRITION_TARGET_MODES);

export type NutritionTargetMode = z.infer<typeof nutritionTargetModeSchema>;

/**
 * One version of the person's target. A change creates a new version; an
 * existing version is never edited, so anything that points at one keeps
 * meaning what it meant.
 */
export const targetVersionSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    targetVersionId: nutritionDocIdSchema,
    mode: nutritionTargetModeSchema,
    values: nutritionValuesSchema,
    effectiveFrom: nutritionDateSchema,
  })
  .strict();

export type TargetVersion = z.infer<typeof targetVersionSchema>;

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

/** A V2 plan covers exactly this many contiguous calendar dates. */
export const NUTRITION_PLAN_DAY_COUNT = 7;

/**
 * A meal the plan proposes. Planned, not eaten.
 *
 * `mealId` is the meal's own identity inside the plan — never its name — so a
 * later reference ("replace with another meal of this plan") stays valid
 * whatever the meal is called.
 */
export const plannedMealSchema = z
  .object({
    mealId: nutritionDocIdSchema,
    slotId: nutritionSlotIdSchema,
    name: displayTextSchema,
    values: nutritionValuesSchema,
  })
  .strict();

export type PlannedMeal = z.infer<typeof plannedMealSchema>;

/** One dated day of a plan and the meals planned for its slots. */
export const nutritionPlanDaySchema = z
  .object({
    date: nutritionDateSchema,
    meals: z.array(plannedMealSchema),
  })
  .strict();

export type NutritionPlanDay = z.infer<typeof nutritionPlanDaySchema>;

/**
 * A base plan: Plan → dated Day → Meal Slot → Meal.
 *
 * Exactly `NUTRITION_PLAN_DAY_COUNT` days, one per calendar date from
 * `startDate` to `endDate`, in order. Every day carries its own ISO date; no
 * day is identified by a weekday. `slotOrder` is the plan's configured slots;
 * every day plans exactly one meal for each of them and nothing outside them.
 * Once the plan is active its content is immutable — a day's change is a
 * date- and slot-scoped `MealOverride`, never an edit here.
 *
 * Structure only. Whether a plan is nutritionally acceptable (totals near the
 * target, sensible meals) is plan-validation policy, not this contract.
 */
export const nutritionPlanSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    planId: nutritionDocIdSchema,
    startDate: nutritionDateSchema,
    endDate: nutritionDateSchema,
    slotOrder: z.array(nutritionSlotIdSchema).min(1, "a plan configures at least one slot"),
    days: z.array(nutritionPlanDaySchema),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const configured = new Set<string>();
    plan.slotOrder.forEach((slotId, index) => {
      if (configured.has(slotId)) issue(["slotOrder", index], `slot ${slotId} is configured more than once`);
      configured.add(slotId);
    });

    // A malformed date is already reported by its own field; zod still runs
    // this refinement, so date arithmetic below must not see it.
    if (!isNutritionDate(plan.startDate)) return;

    if (plan.endDate !== addNutritionDays(plan.startDate, NUTRITION_PLAN_DAY_COUNT - 1)) {
      issue(["endDate"], `endDate must be ${NUTRITION_PLAN_DAY_COUNT - 1} days after startDate`);
    }
    if (plan.days.length !== NUTRITION_PLAN_DAY_COUNT) {
      issue(["days"], `a plan has exactly ${NUTRITION_PLAN_DAY_COUNT} days`);
    }

    const dates = new Set<string>();
    const mealIds = new Set<string>();
    plan.days.forEach((day, dayIndex) => {
      if (dates.has(day.date)) {
        issue(["days", dayIndex, "date"], `date ${day.date} appears more than once`);
      } else if (day.date !== addNutritionDays(plan.startDate, dayIndex)) {
        issue(["days", dayIndex, "date"], "days must be the contiguous dates from startDate, in order");
      }
      dates.add(day.date);

      const slots = new Set<string>();
      day.meals.forEach((meal, mealIndex) => {
        const path = ["days", dayIndex, "meals", mealIndex];
        if (!configured.has(meal.slotId)) issue([...path, "slotId"], `slot ${meal.slotId} is not configured`);
        if (slots.has(meal.slotId)) issue([...path, "slotId"], `slot ${meal.slotId} is planned twice on ${day.date}`);
        slots.add(meal.slotId);
        if (mealIds.has(meal.mealId)) issue([...path, "mealId"], `mealId ${meal.mealId} is not unique in the plan`);
        mealIds.add(meal.mealId);
      });
      for (const slotId of configured) {
        if (!slots.has(slotId)) issue(["days", dayIndex, "meals"], `slot ${slotId} has no meal on ${day.date}`);
      }
    });
  });

export type NutritionPlan = z.infer<typeof nutritionPlanSchema>;

/* ------------------------------------------------------------------ *
 * Slot selection and overrides
 * ------------------------------------------------------------------ */

/** The meal a replacement puts in the slot, as it will be shown. */
const replacementMealSchema = z
  .object({
    name: displayTextSchema,
    values: nutritionValuesSchema,
  })
  .strict();

/**
 * A replacement for one slot on one date. Still planned, not eaten; it leaves
 * the base plan untouched. It comes either from an AI suggestion or from
 * another meal of the same plan (named by `sourceMealId`).
 */
export const mealOverrideSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("aiSuggestion"), meal: replacementMealSchema }).strict(),
  z
    .object({ source: z.literal("planMeal"), sourceMealId: nutritionDocIdSchema, meal: replacementMealSchema })
    .strict(),
]);

export type MealOverride = z.infer<typeof mealOverrideSchema>;

export type MealOverrideSource = MealOverride["source"];

/** What a slot on a date shows: the base plan's meal, or an override. */
export const slotSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("base") }).strict(),
  z.object({ kind: z.literal("override"), override: mealOverrideSchema }).strict(),
]);

export type SlotSelection = z.infer<typeof slotSelectionSchema>;

/**
 * The head of one slot on one date of one plan — where `SlotSelection` and
 * `MealOverride` are persisted together. Addressed by
 * `slotHeadId(planId, date, slotId)`.
 */
export const slotHeadSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    planId: nutritionDocIdSchema,
    date: nutritionDateSchema,
    slotId: nutritionSlotIdSchema,
    selection: slotSelectionSchema,
  })
  .strict();

export type SlotHead = z.infer<typeof slotHeadSchema>;

/* ------------------------------------------------------------------ *
 * Recorded entries
 * ------------------------------------------------------------------ */

/** A slot entry records one of the day's slots; an extra entry is anything else. */
export const RECORDED_ENTRY_KINDS = ["slot", "extra"] as const;

export const recordedEntryKindSchema = z.enum(RECORDED_ENTRY_KINDS);

export type RecordedEntryKind = z.infer<typeof recordedEntryKindSchema>;

/**
 * Where a nutrition estimate came from:
 *
 *   planMealTimesPortion  the planned meal's values times the eaten portion
 *   userStated            numbers the person gave
 *   none                  no estimate
 */
export const ESTIMATE_BASES = ["planMealTimesPortion", "userStated", "none"] as const;

export const estimateBasisSchema = z.enum(ESTIMATE_BASES);

export type EstimateBasis = z.infer<typeof estimateBasisSchema>;

/**
 * A recorded nutrition estimate. `kcal` is always known when there is an
 * estimate at all; a `null` macro means *unknown*, never zero.
 */
export const nutritionEstimateSchema = z
  .object({
    kcal: quantitySchema,
    proteinG: quantitySchema.nullable(),
    carbsG: quantitySchema.nullable(),
    fatG: quantitySchema.nullable(),
  })
  .strict();

export type NutritionEstimate = z.infer<typeof nutritionEstimateSchema>;

/**
 * A recorded entry's state. `removed` is a tombstone: the entry was taken
 * back, its last snapshot is kept as history, and it counts as no recording.
 * An entry is never hard-deleted. A tombstone is not a skip — a skip is an
 * active recording that says the slot was explicitly not eaten.
 */
export const RECORDED_ENTRY_STATUSES = ["active", "removed"] as const;

export const recordedEntryStatusSchema = z.enum(RECORDED_ENTRY_STATUSES);

export type RecordedEntryStatus = z.infer<typeof recordedEntryStatusSchema>;

/**
 * How many applied intent ids an entry remembers. Enough for idempotent retry
 * and replay of recent writes; the oldest id is dropped first.
 */
export const NUTRITION_ENTRY_INTENT_RING_SIZE = 20;

/**
 * The id of one explicit user mutation: a UUID, created once per action and
 * kept through every retry of it. Canonical lower case — what
 * `crypto.randomUUID()` produces — so one intent has exactly one spelling.
 */
export const nutritionIntentIdSchema = z
  .string()
  .refine((value) => isUuid(value) && value === value.toLowerCase(), { message: "intent id must be a lower-case UUID" });

/** Identity: fixed when the entry is created, never changed afterwards. */
const recordedEntryIdentity = {
  schemaVersion: nutritionSchemaVersionSchema,
  entryId: z.string(),
  kind: recordedEntryKindSchema,
  date: nutritionDateSchema,
  slotId: nutritionSlotIdSchema.nullable(),
};

const plannedMealRecording = {
  recording: z.literal("plannedMeal"),
  planId: nutritionDocIdSchema,
  name: displayTextSchema,
  estimateBasis: z.literal("planMealTimesPortion"),
  /** Multiplier on the planned meal. Positive: nothing eaten is a skip, not a portion. No preset domain. */
  portion: quantitySchema.positive("portion must be greater than zero"),
  nutritionEstimate: nutritionValuesSchema,
};

const skipRecording = {
  recording: z.literal("skip"),
  estimateBasis: z.literal("none"),
  nutritionEstimate: z.null(),
};

/**
 * Something the person described. A custom recording is a meal they ate, so it
 * always carries the kcal they stated; its macros may be unknown (`null`).
 */
const customRecording = {
  recording: z.literal("custom"),
  name: displayTextSchema,
  estimateBasis: z.literal("userStated"),
  nutritionEstimate: nutritionEstimateSchema,
};

/**
 * Concurrency and idempotency metadata of a persisted entry.
 *
 *   revision          1 when created; every applied write is exactly +1.
 *   status            `active`, or the `removed` tombstone.
 *   appliedIntentIds  the intents already applied, oldest first, at most
 *                     `NUTRITION_ENTRY_INTENT_RING_SIZE`. A write whose intent
 *                     is listed here has already happened.
 */
const recordedEntryMutation = {
  revision: z.number().int("revision must be a whole number").positive("revision starts at 1"),
  status: recordedEntryStatusSchema,
  appliedIntentIds: z
    .array(nutritionIntentIdSchema)
    .min(1, "an entry exists only because an intent was applied")
    .max(NUTRITION_ENTRY_INTENT_RING_SIZE, `at most ${NUTRITION_ENTRY_INTENT_RING_SIZE} intent ids are kept`),
};

// Optional because the client compiles with `strict: false`, where zod infers
// every field as optional; the refinement runs after the shape has parsed.
type RecordedEntryIdentityFields = {
  entryId?: string;
  kind?: RecordedEntryKind;
  date?: string;
  slotId?: string | null;
  recording?: string;
};

const refineRecordedEntryIdentity = (entry: RecordedEntryIdentityFields, ctx: z.RefinementCtx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (entry.kind === "slot") {
    if (entry.slotId === null) {
      issue("slotId", "a slot entry needs a slotId");
    } else if (
      isNutritionDate(entry.date) &&
      isNutritionSlotId(entry.slotId) &&
      entry.entryId !== slotEntryId(entry.date, entry.slotId)
    ) {
      issue("entryId", "a slot entry's id must be slot:{date}:{slotId}");
    }
  } else {
    if (entry.slotId !== null) issue("slotId", "an extra entry has no slotId");
    if (!isExtraEntryId(entry.entryId)) issue("entryId", "an extra entry's id must be extra:{uuid}");
    if (entry.recording !== "custom") issue("recording", `${entry.recording} is only recorded for a slot`);
  }
};

/**
 * What the person explicitly recorded, without persistence metadata: the full
 * desired state a recording action asks for.
 *
 * `recording` says what was recorded:
 *
 *   plannedMeal  the slot's planned meal was eaten. Snapshots its name and
 *                `planMealTimesPortion` estimate (all four values, since a
 *                planned meal's values are complete) with the portion eaten.
 *   skip         the slot was explicitly skipped. No meal, no estimate.
 *   custom       something the person described, with the kcal they stated
 *                (`userStated`); a macro they did not state is `null`.
 *
 * Every field is a snapshot of the moment of recording. Changing the plan, the
 * slot's override or the target later never recomputes it.
 *
 * Identity: a slot entry has a `slotId` and the id `slot:{date}:{slotId}`; an
 * extra entry has no `slotId` and an id `extra:{uuid}`. Only `custom` can be
 * an extra entry.
 */
export const recordedEntrySnapshotSchema = z
  .discriminatedUnion("recording", [
    z.object({ ...recordedEntryIdentity, ...plannedMealRecording }).strict(),
    z.object({ ...recordedEntryIdentity, ...skipRecording }).strict(),
    z.object({ ...recordedEntryIdentity, ...customRecording }).strict(),
  ])
  .superRefine(refineRecordedEntryIdentity);

export type RecordedEntrySnapshot = z.infer<typeof recordedEntrySnapshotSchema>;

/**
 * One thing the person explicitly recorded — never inferred from the plan —
 * as persisted: the snapshot plus its mutation metadata. A `removed` entry
 * keeps the snapshot it had when it was removed.
 */
export const recordedEntrySchema = z
  .discriminatedUnion("recording", [
    z.object({ ...recordedEntryIdentity, ...plannedMealRecording, ...recordedEntryMutation }).strict(),
    z.object({ ...recordedEntryIdentity, ...skipRecording, ...recordedEntryMutation }).strict(),
    z.object({ ...recordedEntryIdentity, ...customRecording, ...recordedEntryMutation }).strict(),
  ])
  .superRefine((entry, ctx) => {
    refineRecordedEntryIdentity(entry, ctx);
    if (new Set(entry.appliedIntentIds).size !== entry.appliedIntentIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["appliedIntentIds"],
        message: "an intent id is applied at most once",
      });
    }
  });

export type RecordedEntry = z.infer<typeof recordedEntrySchema>;

export type RecordedEntryRecording = RecordedEntry["recording"];

/** The persistence metadata of an entry, apart from its snapshot. */
export const RECORDED_ENTRY_MUTATION_FIELDS = ["revision", "status", "appliedIntentIds"] as const;

/** The identity fields that never change after an entry is created. */
export const RECORDED_ENTRY_IDENTITY_FIELDS = ["schemaVersion", "entryId", "kind", "date", "slotId"] as const;

/** An entry that counts as a recording. A tombstone is history, never a recording. */
export const isActiveRecordedEntry = (entry: Pick<RecordedEntry, "status">): boolean => entry.status === "active";

/* ------------------------------------------------------------------ *
 * Plan generation requests
 * ------------------------------------------------------------------ */

/**
 * What a plan-generation request asks for: the first plan, or a new one in
 * place of the current plan. Replacement suggestions are a separate concept
 * and are not generation requests.
 */
export const GENERATION_REQUEST_KINDS = ["initial", "regenerate"] as const;

export const generationRequestKindSchema = z.enum(GENERATION_REQUEST_KINDS);

export type GenerationRequestKind = z.infer<typeof generationRequestKindSchema>;

/**
 * A request's lifecycle. `discarded_stale`: the request finished but its
 * result no longer applied and was not used.
 */
export const GENERATION_REQUEST_STATUSES = ["queued", "running", "succeeded", "failed", "discarded_stale"] as const;

export const generationRequestStatusSchema = z.enum(GENERATION_REQUEST_STATUSES);

export type GenerationRequestStatus = z.infer<typeof generationRequestStatusSchema>;

/* ------------------------------------------------------------------ *
 * Per-account state
 * ------------------------------------------------------------------ */

/** Pointers to the account's current Nutrition V2 records. */
export const nutritionUserStateSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    activePlanId: nutritionDocIdSchema.nullable(),
    currentTargetVersionId: nutritionDocIdSchema.nullable(),
    activeGenerationRequestId: nutritionDocIdSchema.nullable(),
  })
  .strict();

export type NutritionUserState = z.infer<typeof nutritionUserStateSchema>;
