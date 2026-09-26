import { z } from "zod";
import { isNutritionDate } from "./dates";
import {
  NUTRITION_DOC_ID_PATTERN,
  NUTRITION_SLOT_IDS,
  isExtraEntryId,
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
 * person explicitly recorded it, and its values are an estimate that is
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

/** A meal the plan proposes for a slot. Planned, not eaten. */
export const plannedMealSchema = z
  .object({
    slotId: nutritionSlotIdSchema,
    name: displayTextSchema,
    values: nutritionValuesSchema,
  })
  .strict();

export type PlannedMeal = z.infer<typeof plannedMealSchema>;

export const NUTRITION_PLAN_STATUSES = ["active", "superseded"] as const;

export const nutritionPlanStatusSchema = z.enum(NUTRITION_PLAN_STATUSES);

export type NutritionPlanStatus = z.infer<typeof nutritionPlanStatusSchema>;

/**
 * A base plan: at most one planned meal per slot. Its `meals` are immutable
 * once the plan is active — only `status` moves.
 */
export const nutritionPlanSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    planId: nutritionDocIdSchema,
    status: nutritionPlanStatusSchema,
    /** The target version the plan was made for, when there was one. */
    targetVersionId: nutritionDocIdSchema.nullable(),
    startDate: nutritionDateSchema,
    meals: z.array(plannedMealSchema),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.meals.forEach((meal, index) => {
      if (seen.has(meal.slotId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["meals", index, "slotId"],
          message: `slot ${meal.slotId} is planned more than once`,
        });
      }
      seen.add(meal.slotId);
    });
  });

export type NutritionPlan = z.infer<typeof nutritionPlanSchema>;

/* ------------------------------------------------------------------ *
 * Slot selection and overrides
 * ------------------------------------------------------------------ */

/** Who proposed a replacement meal. */
export const MEAL_OVERRIDE_ORIGINS = ["user", "suggestion"] as const;

export const mealOverrideOriginSchema = z.enum(MEAL_OVERRIDE_ORIGINS);

export type MealOverrideOrigin = z.infer<typeof mealOverrideOriginSchema>;

/**
 * A replacement for one slot on one date. Still planned, not eaten; it leaves
 * the base plan untouched.
 */
export const mealOverrideSchema = z
  .object({
    name: displayTextSchema,
    values: nutritionValuesSchema,
    origin: mealOverrideOriginSchema,
  })
  .strict();

export type MealOverride = z.infer<typeof mealOverrideSchema>;

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

/** A slot entry fills one of the day's slots; an extra entry is anything else. */
export const RECORDED_ENTRY_KINDS = ["slot", "extra"] as const;

export const recordedEntryKindSchema = z.enum(RECORDED_ENTRY_KINDS);

export type RecordedEntryKind = z.infer<typeof recordedEntryKindSchema>;

/**
 * What the person recorded having eaten: the base plan's meal, the slot's
 * override, or something they described themselves.
 */
export const RECORDED_ENTRY_SOURCES = ["baseMeal", "override", "userDescribed"] as const;

export const recordedEntrySourceSchema = z.enum(RECORDED_ENTRY_SOURCES);

export type RecordedEntrySource = z.infer<typeof recordedEntrySourceSchema>;

/**
 * Where the nutrition estimate came from:
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
 * One thing the person explicitly recorded eating.
 *
 * A snapshot: `name`, `nutritionEstimate` and `portion` are what was true when
 * it was recorded. Editing the plan or the override later never recomputes it.
 *
 * Consistency rules:
 *   - a slot entry has a `slotId` and the id `slot:{date}:{slotId}`;
 *     an extra entry has no `slotId` and an id `extra:{uuid}`.
 *   - `baseMeal` / `override` sources need the `planId` they came from, and
 *     only a slot entry can have them.
 *   - `none` ⇔ no estimate.
 *   - `planMealTimesPortion` needs a plan-backed source, a portion, and all
 *     four values (a planned meal's values are complete).
 *   - `portion` is present only for `planMealTimesPortion`.
 */
export const recordedEntrySchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    entryId: z.string(),
    kind: recordedEntryKindSchema,
    date: nutritionDateSchema,
    slotId: nutritionSlotIdSchema.nullable(),
    planId: nutritionDocIdSchema.nullable(),
    source: recordedEntrySourceSchema,
    name: displayTextSchema,
    estimateBasis: estimateBasisSchema,
    /** Multiplier on the planned meal. Positive: nothing eaten is not recorded. */
    portion: quantitySchema.positive("portion must be greater than zero").nullable(),
    nutritionEstimate: nutritionEstimateSchema.nullable(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (entry.kind === "slot") {
      if (entry.slotId === null) {
        issue("slotId", "a slot entry needs a slotId");
      } else if (entry.entryId !== slotEntryId(entry.date, entry.slotId)) {
        issue("entryId", "a slot entry's id must be slot:{date}:{slotId}");
      }
    } else {
      if (entry.slotId !== null) issue("slotId", "an extra entry has no slotId");
      if (!isExtraEntryId(entry.entryId)) issue("entryId", "an extra entry's id must be extra:{uuid}");
    }

    const planBacked = entry.source === "baseMeal" || entry.source === "override";
    if (planBacked && entry.kind !== "slot") issue("source", `${entry.source} is only valid for a slot entry`);
    if (planBacked && entry.planId === null) issue("planId", `${entry.source} needs the planId it came from`);

    const estimate = entry.nutritionEstimate;
    switch (entry.estimateBasis) {
      case "none":
        if (estimate !== null) issue("nutritionEstimate", "basis none has no estimate");
        break;
      case "userStated":
        if (estimate === null) issue("nutritionEstimate", "basis userStated needs an estimate");
        break;
      case "planMealTimesPortion":
        if (!planBacked) issue("estimateBasis", "planMealTimesPortion needs a plan-backed source");
        if (entry.portion === null) issue("portion", "planMealTimesPortion needs a portion");
        if (
          estimate === null ||
          estimate.proteinG === null ||
          estimate.carbsG === null ||
          estimate.fatG === null
        ) {
          issue("nutritionEstimate", "planMealTimesPortion needs all four values");
        }
        break;
    }
    if (entry.estimateBasis !== "planMealTimesPortion" && entry.portion !== null) {
      issue("portion", "portion is only recorded for planMealTimesPortion");
    }
  });

export type RecordedEntry = z.infer<typeof recordedEntrySchema>;

/* ------------------------------------------------------------------ *
 * Generation requests
 * ------------------------------------------------------------------ */

export const GENERATION_REQUEST_TYPES = ["basePlan", "slotSuggestions"] as const;

export const generationRequestTypeSchema = z.enum(GENERATION_REQUEST_TYPES);

export type GenerationRequestType = z.infer<typeof generationRequestTypeSchema>;

export const GENERATION_REQUEST_STATUSES = ["pending", "running", "succeeded", "failed"] as const;

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
