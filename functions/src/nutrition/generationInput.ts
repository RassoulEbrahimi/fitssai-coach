import { z } from "zod";
import {
  NUTRITION_PLAN_DAY_COUNT,
  NUTRITION_SLOT_IDS,
  nutritionDateSchema,
  nutritionDietaryPreferenceSchema,
  nutritionSlotIdSchema,
  nutritionValuesSchema,
  type NutritionDate,
  type NutritionProfile,
  type NutritionSlotId,
  type Sha256Hex,
  type TargetVersion,
} from "../../../shared/nutrition";

/**
 * What a Nutrition plan generator is told (NUT-11): the minimum a week of
 * meals can be planned from, and nothing that identifies the person.
 *
 *   startDate          the first Berlin date of the week, chosen by the server
 *   dayCount           the fixed length of a plan
 *   target             the TARGET values (kcal and macros) — derived numbers,
 *                      never the answers they were derived from
 *   slotOrder          the meal slots each day plans, in canonical day order
 *   dietaryPreference  the signed-off dietary preference, or null
 *
 * Never: an account id, a name or e-mail, age, date of birth, height, weight,
 * biological sex, activity level, fitness goal, a manual kcal answer, the raw
 * profile document, target-policy inputs or any Firestore path. The builder
 * reads the profile through the NUT-03 view, and from that view only the
 * dietary preference — food exclusions are not part of the signed profile
 * contract, so no exclusion can reach a provider, whatever a stored document
 * holds. A later signed-off exclusion vocabulary is one more field here, read
 * the same way.
 *
 * Pure: no Firestore, no clock, no provider. The fingerprint hashes a
 * canonical form of the input and the hash is all that is persisted.
 */

const canonicalSlotOrder = (slots: readonly NutritionSlotId[]): NutritionSlotId[] =>
  NUTRITION_SLOT_IDS.filter((slotId) => slots.includes(slotId));

export const nutritionGenerationInputSchema = z
  .object({
    startDate: nutritionDateSchema,
    dayCount: z.literal(NUTRITION_PLAN_DAY_COUNT),
    target: nutritionValuesSchema,
    slotOrder: z.array(nutritionSlotIdSchema).min(1, "a plan configures at least one slot"),
    dietaryPreference: nutritionDietaryPreferenceSchema.nullable(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const canonical = canonicalSlotOrder(input.slotOrder);
    if (canonical.length !== input.slotOrder.length || canonical.some((slotId, index) => slotId !== input.slotOrder[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slotOrder"], message: "slots are unique, in canonical day order" });
    }
  });

export type NutritionGenerationInput = z.infer<typeof nutritionGenerationInputSchema>;

export class NutritionGenerationInputError extends Error {
  constructor(detail: string) {
    super(`The generation input cannot be built: ${detail}`);
    this.name = "NutritionGenerationInputError";
  }
}

export interface NutritionGenerationInputSources {
  startDate: NutritionDate;
  /** The captured target version; only its values are read. */
  target: Pick<TargetVersion, "values">;
  /** The week's slots: the base plan's for a regeneration, the injected configuration's for a first plan. */
  slotOrder: readonly NutritionSlotId[];
  /** The NUT-03 view of the profile; only the dietary preference is read. */
  profile: Pick<NutritionProfile, "dietaryPreference">;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/**
 * The minimized input, built field by field from the sources — never by
 * copying an object — and checked by the strict schema. A fresh, deep-frozen
 * value.
 */
export const buildNutritionGenerationInput = ({
  startDate,
  target,
  slotOrder,
  profile,
}: NutritionGenerationInputSources): NutritionGenerationInput => {
  const dietary = profile.dietaryPreference;
  const candidate = {
    startDate,
    dayCount: NUTRITION_PLAN_DAY_COUNT,
    target: {
      kcal: target.values.kcal,
      proteinG: target.values.proteinG,
      carbsG: target.values.carbsG,
      fatG: target.values.fatG,
    },
    slotOrder: canonicalSlotOrder(slotOrder),
    dietaryPreference: dietary.status === "answered" ? dietary.value : null,
  };
  if (new Set(slotOrder).size !== slotOrder.length) throw new NutritionGenerationInputError("a slot is listed twice");
  const parsed = nutritionGenerationInputSchema.safeParse(candidate);
  if (!parsed.success) throw new NutritionGenerationInputError("it does not match the input contract");
  return deepFreeze(parsed.data);
};

/* ------------------------------------------------------------------ *
 * Fingerprint
 * ------------------------------------------------------------------ */

/** Bumped only if the material's layout ever changes; part of the material itself. */
export const NUTRITION_GENERATION_INPUT_FORMAT = 1;

/**
 * The canonical string that is hashed: arrays in a fixed order only, so the
 * key order of the input object and the order its slots arrive in cannot
 * change it. It carries the input, so it is hashed and never stored.
 */
export const nutritionGenerationInputMaterial = (input: NutritionGenerationInput): string =>
  JSON.stringify([
    "fitssai.nutrition.generationInput",
    NUTRITION_GENERATION_INPUT_FORMAT,
    input.startDate,
    input.dayCount,
    [input.target.kcal, input.target.proteinG, input.target.carbsG, input.target.fatG],
    canonicalSlotOrder(input.slotOrder),
    input.dietaryPreference,
  ]);

/** The request's `payloadFingerprint`: SHA-256 of the canonical material, lower-case hex. */
export const computeNutritionGenerationFingerprint = async (
  input: NutritionGenerationInput,
  sha256Hex: Sha256Hex
): Promise<string> => sha256Hex(nutritionGenerationInputMaterial(input));

/* ------------------------------------------------------------------ *
 * First-plan slots
 * ------------------------------------------------------------------ */

/**
 * Which slots a FIRST plan configures. A regeneration keeps its base plan's
 * slots; a first plan has none to keep, and which slots two, three or four
 * meals a day mean — which snack is which — is not signed off. So the mapping
 * is injected, and production has none.
 */
export interface NutritionInitialSlotConfiguration {
  /** The slots for the person's answered meals per day (null: not answered), or null when there is no mapping for it. */
  slotsFor(mealsPerDay: number | null): readonly NutritionSlotId[] | null;
}

/** The deployed configuration: no mapping is signed off, so no first plan can be configured. */
export const productionInitialSlotConfiguration: NutritionInitialSlotConfiguration = Object.freeze({
  slotsFor: () => null,
});
