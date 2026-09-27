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
 * An instant as Firestore stores it: whole seconds since the epoch and the
 * nanoseconds within that second.
 *
 * Structural on purpose, so this contract stays Firebase-independent: the
 * client SDK's `Timestamp` carries `seconds`/`nanoseconds` as own properties,
 * the Admin SDK's as getters, and both parse. Not `.strict()` for the same
 * reason — an SDK timestamp has private fields of its own — and the parsed
 * value is the plain `{ seconds, nanoseconds }`, never the SDK class.
 */
export const nutritionTimestampSchema = z.object({
  seconds: z.number().int("seconds must be a whole number"),
  nanoseconds: z.number().int("nanoseconds must be a whole number").min(0).max(999_999_999),
});

export type NutritionTimestamp = z.infer<typeof nutritionTimestampSchema>;

/** A server policy's stable identifier, and its version (which starts at 1). */
const policyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "policy id must be a lower-case identifier");
const policyVersionSchema = z.number().int("policy version must be a whole number").positive("policy version starts at 1");

/**
 * Which target policy produced a target, and which version of it. A policy
 * is the versioned, signed-off rule that turns profile answers into target
 * values; the policies themselves live on the server, not in this contract.
 */
export const targetPolicyRefSchema = z
  .object({
    id: policyIdSchema,
    version: policyVersionSchema,
  })
  .strict();

export type TargetPolicyRef = z.infer<typeof targetPolicyRefSchema>;

/** A lower-case hex SHA-256 digest. */
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "hash must be a lower-case hex SHA-256 digest");

/**
 * What a target's profile inputs looked like, without the inputs themselves:
 * the SHA-256 of the canonical fingerprint material (`./fingerprint`) and the
 * names of the profile fields it covers — never their values.
 *
 * `fields` is a list of names in canonical (sorted, unique) order. A name this
 * build does not know is still a valid document — a newer policy may read a
 * newer field — and simply cannot be compared (`deriveNutritionTargetFreshness`).
 */
export const profileFingerprintSchema = z
  .object({
    hash: sha256HexSchema,
    fields: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "a fingerprint field is a field name"))
      .refine((fields) => fields.every((field, index) => index === 0 || fields[index - 1] < field), {
        message: "fingerprint fields are sorted and unique",
      }),
  })
  .strict();

export type ProfileFingerprint = z.infer<typeof profileFingerprintSchema>;

/**
 * One version of the person's TARGET: what they aim for — never what a plan
 * proposes and never what was recorded. A change creates a new version; an
 * existing version is never edited, so anything that points at one keeps
 * meaning what it meant.
 *
 *   values                     unrounded; rounding is presentation
 *   effectiveFrom              the Berlin date the server created it on
 *   effectiveOrder             the account state revision that created it, so
 *                              two versions of the same date have an order
 *   policy                     the target policy (id and version) that
 *                              computed it — manual targets too, since their
 *                              bounds are policy as well
 *   profileFingerprint         the hash and field names of the profile inputs
 *                              it was computed from; never the raw inputs
 *   supersedesTargetVersionId  the version that was current before it, if any
 *   createdAt                  the server instant it was created
 *
 * Calculated and manual targets share this one shape; they differ only in
 * `mode`, `policy` and the fields their fingerprint covers.
 */
export const targetVersionSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    targetVersionId: nutritionDocIdSchema,
    mode: nutritionTargetModeSchema,
    values: nutritionValuesSchema,
    effectiveFrom: nutritionDateSchema,
    effectiveOrder: z.number().int("effectiveOrder must be a whole number").positive("effectiveOrder starts at 1"),
    policy: targetPolicyRefSchema,
    profileFingerprint: profileFingerprintSchema,
    supersedesTargetVersionId: nutritionDocIdSchema.nullable(),
    createdAt: nutritionTimestampSchema,
  })
  .strict()
  .refine((target) => target.supersedesTargetVersionId !== target.targetVersionId, {
    message: "a target version cannot supersede itself",
    path: ["supersedesTargetVersionId"],
  });

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

/** A plan's base content: its dates, its configured slots and its planned meals. */
const nutritionPlanContentObject = z.object({
  startDate: nutritionDateSchema,
  endDate: nutritionDateSchema,
  slotOrder: z.array(nutritionSlotIdSchema).min(1, "a plan configures at least one slot"),
  days: z.array(nutritionPlanDaySchema),
});

/**
 * The structural hard rules of a plan's content: exactly
 * `NUTRITION_PLAN_DAY_COUNT` contiguous dates from `startDate` to `endDate`,
 * unique configured slots, exactly one meal per configured slot per date and
 * nothing outside them, and meal ids unique within the plan.
 */
const refineNutritionPlanContent = (plan: z.infer<typeof nutritionPlanContentObject>, ctx: z.RefinementCtx) => {
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
};

/**
 * A plan's base content alone — what a generator proposes or a repeat
 * copies — checked by the same structural rules as a persisted plan. Structure
 * only: content that passes is not thereby acceptable for any target.
 */
export const nutritionPlanContentSchema = nutritionPlanContentObject.strict().superRefine(refineNutritionPlanContent);

/**
 * Which plan-validation policy accepted a plan, and which version of it.
 *
 * The same shape as a `TargetPolicyRef`, and deliberately a different schema:
 * a plan-validation policy decides whether a plan may be persisted for a
 * target, a target policy computes the target, and one is never recorded in
 * place of the other. The policies themselves live on the server.
 */
export const planValidationPolicyRefSchema = z
  .object({
    id: policyIdSchema,
    version: policyVersionSchema,
  })
  .strict();

export type PlanValidationPolicyRef = z.infer<typeof planValidationPolicyRefSchema>;

/**
 * Why a persisted plan was allowed to be persisted: the policy that accepted
 * it. Only accepted plans are ever persisted, so the outcome is always
 * `accepted`; a policy's reasoning and any limits it applied are not recorded.
 * Accepted means "passed that policy version", never "healthy" or "balanced".
 */
export const planValidationProvenanceSchema = z
  .object({
    policy: planValidationPolicyRefSchema,
    outcome: z.literal("accepted"),
  })
  .strict();

export type PlanValidationProvenance = z.infer<typeof planValidationProvenanceSchema>;

/**
 * Where a base plan came from: generated for the person, or a repeat of an
 * earlier plan's base content.
 */
export const NUTRITION_PLAN_SOURCES = ["generated", "repeated"] as const;

export const nutritionPlanSourceSchema = z.enum(NUTRITION_PLAN_SOURCES);

export type NutritionPlanSource = z.infer<typeof nutritionPlanSourceSchema>;

/**
 * A persisted plan's lifecycle. There is no draft, pending or deleted plan: a
 * plan is persisted only when it is activated, and an activated plan is only
 * ever superseded — once — by its successor.
 *
 *   active      the account's current base plan (`state.activePlanId`)
 *   superseded  replaced by `supersededByPlanId`; it still owns its dates up to
 *               and including `effectiveUntil`
 */
export const NUTRITION_PLAN_LIFECYCLE_STATUSES = ["active", "superseded"] as const;

export const nutritionPlanLifecycleSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("active"),
      effectiveUntil: z.null(),
      supersededByPlanId: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal("superseded"),
      effectiveUntil: nutritionDateSchema,
      supersededByPlanId: nutritionDocIdSchema,
    })
    .strict(),
]);

export type NutritionPlanLifecycle = z.infer<typeof nutritionPlanLifecycleSchema>;

/**
 * A base plan: Plan → dated Day → Meal Slot → Meal, with the server's
 * persistence metadata.
 *
 * Exactly `NUTRITION_PLAN_DAY_COUNT` days, one per calendar date from
 * `startDate` to `endDate`, in order. Every day carries its own ISO date; no
 * day is identified by a weekday. `slotOrder` is the plan's configured slots;
 * every day plans exactly one meal for each of them and nothing outside them.
 *
 * Persistence metadata:
 *
 *   targetVersionId      the TARGET version the plan was made and validated for
 *   source               `generated`, or `repeated` from `repeatedFromPlanId`
 *   repeatedFromPlanId   the repeated plan's id; null for a generated plan
 *   generationRequestId  the generation request that produced it, if known;
 *                        always null for a repeated plan
 *   validation           the plan-validation policy version that accepted it
 *   createdAt            the server instant the document was created
 *   activatedAt          the server instant it became the active plan
 *   lifecycle            active, or superseded (see `nutritionPlanLifecycleSchema`)
 *
 * Once persisted the plan is immutable except for its one lifecycle
 * transition, active → superseded (`assertPlanTransition` in `./plan`). A
 * day's change is a date- and slot-scoped `MealOverride`, never an edit here,
 * and a new target or a recording never rewrites the plan.
 *
 * Structure only. Whether a plan is nutritionally acceptable for its target is
 * plan-validation policy, which lives on the server; a structurally valid plan
 * is not thereby approved.
 */
export const nutritionPlanSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    planId: nutritionDocIdSchema,
    ...nutritionPlanContentObject.shape,
    targetVersionId: nutritionDocIdSchema,
    source: nutritionPlanSourceSchema,
    repeatedFromPlanId: nutritionDocIdSchema.nullable(),
    generationRequestId: nutritionDocIdSchema.nullable(),
    validation: planValidationProvenanceSchema,
    createdAt: nutritionTimestampSchema,
    activatedAt: nutritionTimestampSchema,
    lifecycle: nutritionPlanLifecycleSchema,
  })
  .strict()
  .superRefine((plan, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (plan.source === "repeated") {
      if (plan.repeatedFromPlanId === null) issue(["repeatedFromPlanId"], "a repeated plan names the plan it repeats");
      if (plan.repeatedFromPlanId === plan.planId) issue(["repeatedFromPlanId"], "a plan cannot repeat itself");
      if (plan.generationRequestId !== null) issue(["generationRequestId"], "a repeated plan was not generated");
    } else if (plan.repeatedFromPlanId !== null) {
      issue(["repeatedFromPlanId"], "only a repeated plan names a plan it repeats");
    }

    const { activatedAt, createdAt } = plan;
    if (
      activatedAt.seconds < createdAt.seconds ||
      (activatedAt.seconds === createdAt.seconds && activatedAt.nanoseconds < createdAt.nanoseconds)
    ) {
      issue(["activatedAt"], "a plan cannot be activated before it was created");
    }

    if (plan.lifecycle.status === "superseded") {
      if (plan.lifecycle.supersededByPlanId === plan.planId) {
        issue(["lifecycle", "supersededByPlanId"], "a plan cannot supersede itself");
      }
      // Dates are YYYY-MM-DD, so string order is calendar order. A superseded
      // plan owns a non-empty prefix of its own dates, never more.
      const until = plan.lifecycle.effectiveUntil;
      if (isNutritionDate(until) && (until < plan.startDate || until > plan.endDate)) {
        issue(["lifecycle", "effectiveUntil"], "effectiveUntil must be one of the plan's own dates");
      }
    }

    refineNutritionPlanContent(plan, ctx);
  });

export type NutritionPlan = z.infer<typeof nutritionPlanSchema>;

/** A plan's base content — its dates, slots and planned meals — without identity or metadata. */
export type NutritionPlanContent = Pick<NutritionPlan, "startDate" | "endDate" | "slotOrder" | "days">;

/* ------------------------------------------------------------------ *
 * Slot selection and overrides
 * ------------------------------------------------------------------ */

/**
 * A lower-case UUID: an id the server mints (an override) or a request id, so
 * one id has exactly one spelling.
 */
const lowerCaseUuidSchema = z
  .string()
  .refine((value) => isUuid(value) && value === value.toLowerCase(), { message: "id must be a lower-case UUID" });

/**
 * Which replacement-validation policy accepted a suggestion's candidates, and
 * which version of it. The same shape as a plan's validation provenance and
 * deliberately a different schema: a policy that accepts a whole week is not
 * thereby one that accepts a single replacement meal. No such policy is
 * signed off yet; the production suggestion source (NUT-12) will name one.
 */
export const replacementValidationProvenanceSchema = z
  .object({
    policy: z.object({ id: policyIdSchema, version: policyVersionSchema }).strict(),
    outcome: z.literal("accepted"),
  })
  .strict();

export type ReplacementValidationProvenance = z.infer<typeof replacementValidationProvenanceSchema>;

/**
 * Where an override's meal came from — resolved by the server, never sent by
 * a browser:
 *
 *   planMeal      a copy of another BASE meal of the same plan and slot,
 *                 named by `sourceMealId`
 *   aiSuggestion  the candidate `candidateId` of the server-held suggestion
 *                 set `suggestionSetId`, with the validation provenance that
 *                 set carried
 */
export const MEAL_OVERRIDE_SOURCES = ["planMeal", "aiSuggestion"] as const;

export type MealOverrideSource = (typeof MEAL_OVERRIDE_SOURCES)[number];

export const mealOverrideOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("planMeal"), sourceMealId: nutritionDocIdSchema }).strict(),
  z
    .object({
      kind: z.literal("aiSuggestion"),
      suggestionSetId: nutritionDocIdSchema,
      candidateId: nutritionDocIdSchema,
      validation: replacementValidationProvenanceSchema,
    })
    .strict(),
]);

export type MealOverrideOrigin = z.infer<typeof mealOverrideOriginSchema>;

/**
 * One committed replacement of one slot on one date of one plan. PLANNED, not
 * eaten; the base plan is not touched.
 *
 *   overrideId          server-minted once per confirmed action
 *   planId/date/slotId  the one slot it replaces
 *   baseMealId          the plan's own meal for that slot and date
 *   previousOverrideId  the override that was selected when it was committed,
 *                       or null when the base meal was; undo walks back along it
 *   meal                a complete planned-meal snapshot with its own mealId —
 *                       never the base meal's, never derived from a name
 *   source              where the meal came from (`mealOverrideOriginSchema`)
 *   createdAtRevision   the slot-head revision its commit produced
 *   createdAt           the server instant of that commit
 *
 * Immutable: stored in its slot head's history for good, including after it is
 * undone. It is active only while the head's selection names it.
 */
export const mealOverrideSchema = z
  .object({
    overrideId: lowerCaseUuidSchema,
    planId: nutritionDocIdSchema,
    date: nutritionDateSchema,
    slotId: nutritionSlotIdSchema,
    baseMealId: nutritionDocIdSchema,
    previousOverrideId: lowerCaseUuidSchema.nullable(),
    meal: plannedMealSchema,
    source: mealOverrideOriginSchema,
    createdAtRevision: z.number().int("createdAtRevision must be a whole number").positive("revisions start at 1"),
    createdAt: nutritionTimestampSchema,
  })
  .strict()
  .superRefine((override, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (override.meal.slotId !== override.slotId) issue(["meal", "slotId"], "the meal is for another slot");
    if (override.meal.mealId === override.baseMealId) issue(["meal", "mealId"], "an override meal has its own id");
    if (override.previousOverrideId === override.overrideId) {
      issue(["previousOverrideId"], "an override cannot follow itself");
    }
    if (override.source.kind === "planMeal" && override.source.sourceMealId === override.baseMealId) {
      issue(["source", "sourceMealId"], "the base meal is restored by undo, not by an override");
    }
  });

export type MealOverride = z.infer<typeof mealOverrideSchema>;

/**
 * What a slot on a date shows: the base plan's meal, or the override of the
 * head's own history that `overrideId` names. The selection points into the
 * history; it never carries a copy of the meal.
 */
export const slotSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("base") }).strict(),
  z.object({ kind: z.literal("override"), overrideId: lowerCaseUuidSchema }).strict(),
]);

export type SlotSelection = z.infer<typeof slotSelectionSchema>;

/**
 * How many applied request ids a slot head remembers, for callable
 * idempotency. Operational storage only — like the entry intent ring and the
 * state ledger it has no nutrition meaning. The oldest id is evicted first.
 */
export const NUTRITION_SLOT_REQUEST_RING_SIZE = 20;

const timestampOrder = (a: NutritionTimestamp, b: NutritionTimestamp): number =>
  a.seconds !== b.seconds ? a.seconds - b.seconds : a.nanoseconds - b.nanoseconds;

/**
 * The head of one slot on one date of one plan: the compare-and-set record of
 * that slot's PLANNED meal, addressed by `slotHeadId(planId, date, slotId)`.
 *
 *   revision           1 when the first override is committed; every applied
 *                      commit or undo is exactly +1. An absent head is the base
 *                      meal at revision 0 (`slotHeadRevision`).
 *   selection          base, or one override of `overrides`
 *   overrides          the append-only history, keyed by `overrideId`; every
 *                      override ever committed for the slot, never edited or
 *                      removed
 *   appliedRequestIds  the requests already applied, oldest first, at most
 *                      `NUTRITION_SLOT_REQUEST_RING_SIZE`; a request listed here
 *                      has already happened
 *   updatedAt          the server instant of the last applied request
 *
 * A head exists only because an override was committed, so its history is
 * never empty. The history grows by one per commit; its size is not bounded
 * here because nothing about a slot's history may be dropped.
 */
export const slotHeadSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    planId: nutritionDocIdSchema,
    date: nutritionDateSchema,
    slotId: nutritionSlotIdSchema,
    revision: z.number().int("revision must be a whole number").positive("a persisted head starts at revision 1"),
    selection: slotSelectionSchema,
    overrides: z.record(z.string(), mealOverrideSchema),
    appliedRequestIds: z
      .array(lowerCaseUuidSchema)
      .min(1, "a head exists only because a request was applied")
      .max(NUTRITION_SLOT_REQUEST_RING_SIZE, `at most ${NUTRITION_SLOT_REQUEST_RING_SIZE} request ids are kept`),
    updatedAt: nutritionTimestampSchema,
  })
  .strict()
  .superRefine((head, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const entries = Object.entries(head.overrides);
    if (entries.length === 0) issue(["overrides"], "a head has at least one committed override");

    const revisions = new Set<number>();
    let baseMealId: string | null = null;
    for (const [key, override] of entries) {
      const path = ["overrides", key];
      if (key !== override.overrideId) issue(path, "an override is stored under its own overrideId");
      if (override.planId !== head.planId || override.date !== head.date || override.slotId !== head.slotId) {
        issue(path, "an override belongs to its head's plan, date and slot");
      }
      if (override.createdAtRevision > head.revision) issue([...path, "createdAtRevision"], "created after the head's revision");
      if (revisions.has(override.createdAtRevision)) {
        issue([...path, "createdAtRevision"], "one revision commits at most one override");
      }
      revisions.add(override.createdAtRevision);
      if (baseMealId !== null && override.baseMealId !== baseMealId) {
        issue([...path, "baseMealId"], "every override of a slot replaces the same base meal");
      }
      baseMealId = override.baseMealId;
      if (timestampOrder(override.createdAt, head.updatedAt) > 0) issue([...path, "createdAt"], "created after updatedAt");

      if (override.previousOverrideId !== null) {
        const previous = head.overrides[override.previousOverrideId];
        // Strictly earlier: no self-reference, no cycle, no dangling pointer.
        if (!previous || previous.overrideId !== override.previousOverrideId) {
          issue([...path, "previousOverrideId"], "points to no override of this history");
        } else if (previous.createdAtRevision >= override.createdAtRevision) {
          issue([...path, "previousOverrideId"], "points to an override that is not earlier");
        }
      }
    }

    if (head.selection.kind === "override") {
      const selected = head.overrides[head.selection.overrideId];
      if (!selected || selected.overrideId !== head.selection.overrideId) {
        issue(["selection", "overrideId"], "the selection names no override of this history");
      }
    }

    if (new Set(head.appliedRequestIds).size !== head.appliedRequestIds.length) {
      issue(["appliedRequestIds"], "a request id is applied at most once");
    }
    // Every applied request moved the revision by exactly one.
    if (head.appliedRequestIds.length > head.revision) {
      issue(["appliedRequestIds"], "more requests are recorded than the revision has applied");
    }
  });

export type SlotHead = z.infer<typeof slotHeadSchema>;

/**
 * The revision a slot is at: 0 while it has no head (the base meal, never
 * changed), the head's revision otherwise.
 */
export const slotHeadRevision = (head: Pick<SlotHead, "revision"> | null | undefined): number => head?.revision ?? 0;

/**
 * The override a head selects, or null when it selects the base meal (or
 * there is no head). A selection that names no override of the history is a
 * malformed head, which the schema refuses before this is reached.
 */
export const selectedMealOverride = (head: SlotHead | null | undefined): MealOverride | null => {
  if (!head || head.selection.kind !== "override") return null;
  const override = head.overrides[head.selection.overrideId];
  if (!override) throw new Error(`slot head selects ${head.selection.overrideId}, which is not in its history`);
  return override;
};

/* ------------------------------------------------------------------ *
 * Replacement suggestions (server-only storage)
 * ------------------------------------------------------------------ */

/**
 * One candidate of a suggestion set: a complete, server-normalised planned
 * meal for the set's slot. `consumedByRequestId`: the request that committed
 * it, once one has; a consumed candidate is never committed again.
 */
export const replacementSuggestionCandidateSchema = z
  .object({
    candidateId: nutritionDocIdSchema,
    meal: plannedMealSchema,
    consumedByRequestId: lowerCaseUuidSchema.nullable(),
  })
  .strict();

export type ReplacementSuggestionCandidate = z.infer<typeof replacementSuggestionCandidateSchema>;

/**
 * Replacement candidates the server holds for exactly one slot of one date of
 * one plan of one account, at
 * `_nutrition_v2_suggestions/{ownerUid}__{suggestionSetId}`. SERVER ONLY: no
 * client reads or writes it, and a browser names a candidate by its ids only.
 *
 *   validation  the replacement-validation policy that accepted the candidates
 *   expiresAt   after this server instant no candidate can be committed. The
 *               duration is not decided here — whoever stores a set supplies
 *               it — and the field is a Firestore timestamp, ready for a TTL
 *               policy the infrastructure may enable.
 *
 * A committed candidate is snapshotted into its `MealOverride`, so the
 * override keeps its meal after the set expires or is deleted.
 */
export const replacementSuggestionSetSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    ownerUid: z.string().min(1, "ownerUid is required").regex(/^[^/]+$/, "ownerUid is an account id"),
    suggestionSetId: nutritionDocIdSchema,
    planId: nutritionDocIdSchema,
    date: nutritionDateSchema,
    slotId: nutritionSlotIdSchema,
    candidates: z.array(replacementSuggestionCandidateSchema).min(1, "a suggestion set has at least one candidate"),
    validation: replacementValidationProvenanceSchema,
    createdAt: nutritionTimestampSchema,
    expiresAt: nutritionTimestampSchema,
  })
  .strict()
  .superRefine((set, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const candidateIds = new Set<string>();
    const mealIds = new Set<string>();
    set.candidates.forEach((candidate, index) => {
      if (candidateIds.has(candidate.candidateId)) issue(["candidates", index, "candidateId"], "candidate ids are unique");
      candidateIds.add(candidate.candidateId);
      if (mealIds.has(candidate.meal.mealId)) issue(["candidates", index, "meal", "mealId"], "meal ids are unique");
      mealIds.add(candidate.meal.mealId);
      if (candidate.meal.slotId !== set.slotId) issue(["candidates", index, "meal", "slotId"], "a candidate is for the set's slot");
    });
    if (timestampOrder(set.expiresAt, set.createdAt) <= 0) issue(["expiresAt"], "a set expires after it was created");
  });

export type ReplacementSuggestionSet = z.infer<typeof replacementSuggestionSetSchema>;

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

/**
 * How many applied state requests the account state remembers, for request
 * idempotency. Operational storage only — like the entry intent ring it has
 * no nutrition meaning. The oldest record is evicted first.
 */
export const NUTRITION_STATE_REQUEST_LEDGER_SIZE = 20;

/**
 * The id of one explicit server request (e.g. one "set target" action): a
 * lower-case UUID, created once per action and kept through every retry of
 * it. Never a document id — the server mints those.
 */
export const nutritionRequestIdSchema = z
  .string()
  .refine((value) => isUuid(value) && value === value.toLowerCase(), { message: "request id must be a lower-case UUID" });

/** The state-changing operations that are recorded in the request ledger. */
export const NUTRITION_STATE_OPERATIONS = ["setTarget", "repeatPlan"] as const;

export type NutritionStateOperation = (typeof NUTRITION_STATE_OPERATIONS)[number];

/**
 * One applied request and what it produced:
 *
 *   setTarget   the target version it created (NUT-08)
 *   repeatPlan  the plan it created and activated (NUT-09)
 */
export const nutritionStateRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      requestId: nutritionRequestIdSchema,
      operation: z.literal("setTarget"),
      resultTargetVersionId: nutritionDocIdSchema,
    })
    .strict(),
  z
    .object({
      requestId: nutritionRequestIdSchema,
      operation: z.literal("repeatPlan"),
      resultPlanId: nutritionDocIdSchema,
    })
    .strict(),
]);

export type NutritionStateRequest = z.infer<typeof nutritionStateRequestSchema>;

/**
 * The account's Nutrition V2 state: pointers to its current records, and the
 * account's concurrency anchor.
 *
 *   revision        the monotonic concurrency revision of this document. 1
 *                   once the state exists (it is created by its first applied
 *                   request); every applied state change — a new target, an
 *                   activated plan — is exactly +1. Reads, replays of an
 *                   applied request, refusals and failed transactions never
 *                   change it. It is not the ledger's length: old records are
 *                   evicted, the revision keeps counting.
 *   recentRequests  the requests already applied, oldest first, at most
 *                   `NUTRITION_STATE_REQUEST_LEDGER_SIZE`, of every operation
 *                   together. A request whose id is listed here has already
 *                   happened; replaying it returns what it produced.
 */
export const nutritionUserStateSchema = z
  .object({
    schemaVersion: nutritionSchemaVersionSchema,
    revision: z.number().int("revision must be a whole number").positive("revision starts at 1"),
    activePlanId: nutritionDocIdSchema.nullable(),
    currentTargetVersionId: nutritionDocIdSchema.nullable(),
    activeGenerationRequestId: nutritionDocIdSchema.nullable(),
    recentRequests: z
      .array(nutritionStateRequestSchema)
      .max(NUTRITION_STATE_REQUEST_LEDGER_SIZE, `at most ${NUTRITION_STATE_REQUEST_LEDGER_SIZE} requests are kept`),
  })
  .strict()
  .superRefine((state, ctx) => {
    const ids = state.recentRequests.map((request) => request.requestId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recentRequests"], message: "a request id is applied at most once" });
    }
    // Every applied request moved the revision by exactly one.
    if (state.recentRequests.length > state.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recentRequests"],
        message: "more requests are recorded than the revision has applied",
      });
    }
  });

export type NutritionUserState = z.infer<typeof nutritionUserStateSchema>;
