import {
  NUTRITION_SCHEMA_VERSION,
  addNutritionDays,
  extraEntryId,
  slotEntryId,
  slotHeadId,
  type MealOverride,
  type NutritionDate,
  type NutritionPlan,
  type NutritionSlotId,
  type NutritionUserState,
  type NutritionValues,
  type RecordedEntry,
  type SlotHead,
  type TargetVersion,
} from "@shared/nutrition";

/*
  Valid Nutrition V2 documents for tests (NUT-05). Built from the NUT-01
  identity helpers, so every id is the canonical one; tests that need a broken
  document start from these and break exactly one thing.
*/

export const PLAN_ID = "plan-1";
/** A Wednesday: plan days are dates, never weekdays. */
export const PLAN_START: NutritionDate = "2026-09-23";
export const PLAN_END: NutritionDate = "2026-09-29";

export const values = (kcal: number, proteinG: number, carbsG: number, fatG: number): NutritionValues => ({
  kcal,
  proteinG,
  carbsG,
  fatG,
});

/** Base values per slot; day `i` adds `i` kcal to each meal so days are told apart. */
const BASE_VALUES: Record<NutritionSlotId, NutritionValues> = {
  breakfast: values(400.4, 20, 50, 10),
  lunch: values(700.2, 40, 80, 20),
  snack_1: values(150, 5, 20, 5),
  dinner: values(600.3, 35, 60, 25),
  snack_2: values(120, 4, 15, 4),
};

export const mealIdFor = (dayIndex: number, slotId: NutritionSlotId) => `m-${dayIndex}-${slotId.replace("_", "")}`;

export const makePlan = ({
  planId = PLAN_ID,
  startDate = PLAN_START,
  slotOrder = ["breakfast", "lunch", "dinner"],
}: { planId?: string; startDate?: NutritionDate; slotOrder?: NutritionSlotId[] } = {}): NutritionPlan => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  planId,
  startDate,
  endDate: addNutritionDays(startDate, 6),
  slotOrder,
  days: Array.from({ length: 7 }, (_, dayIndex) => ({
    date: addNutritionDays(startDate, dayIndex),
    // Stored in reverse on purpose: order comes from slotOrder, not storage.
    meals: [...slotOrder].reverse().map((slotId) => ({
      mealId: mealIdFor(dayIndex, slotId),
      slotId,
      name: `${slotId} ${dayIndex}`,
      values: { ...BASE_VALUES[slotId], kcal: BASE_VALUES[slotId].kcal + dayIndex },
    })),
  })),
});

export const makeState = (overrides: Partial<NutritionUserState> = {}): NutritionUserState => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  activePlanId: PLAN_ID,
  currentTargetVersionId: "target-1",
  activeGenerationRequestId: null,
  ...overrides,
});

export const makeTarget = (targetVersionId = "target-1"): TargetVersion => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  targetVersionId,
  mode: "manual",
  values: values(2200, 140, 250, 70),
  effectiveFrom: PLAN_START,
});

export const aiOverride = (name = "Linsen-Curry", kcal = 900): MealOverride => ({
  source: "aiSuggestion",
  meal: { name, values: values(kcal, 30, 110, 25) },
});

export const makeSlotHead = (
  date: NutritionDate,
  slotId: NutritionSlotId,
  override: MealOverride | null = aiOverride(),
  planId = PLAN_ID
): SlotHead => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  planId,
  date,
  slotId,
  selection: override ? { kind: "override", override } : { kind: "base" },
});

export const slotHeadDocId = (head: SlotHead) => slotHeadId(head.planId, head.date, head.slotId);

export const plannedMealEntry = (
  date: NutritionDate,
  slotId: NutritionSlotId,
  estimate: NutritionValues = values(123, 4, 5, 6),
  planId = PLAN_ID
): RecordedEntry => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  entryId: slotEntryId(date, slotId),
  kind: "slot",
  date,
  slotId,
  recording: "plannedMeal",
  planId,
  name: "Snapshot name",
  estimateBasis: "planMealTimesPortion",
  portion: 1,
  nutritionEstimate: estimate,
});

export const skipEntry = (date: NutritionDate, slotId: NutritionSlotId): RecordedEntry => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  entryId: slotEntryId(date, slotId),
  kind: "slot",
  date,
  slotId,
  recording: "skip",
  estimateBasis: "none",
  nutritionEstimate: null,
});

export const extraEntry = (
  date: NutritionDate,
  uuid = "0f8fad5b-d9cb-469f-a165-70867728950e"
): RecordedEntry => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  entryId: extraEntryId(uuid),
  kind: "extra",
  date,
  slotId: null,
  recording: "custom",
  name: "Apfel",
  estimateBasis: "userStated",
  nutritionEstimate: { kcal: 80, proteinG: null, carbsG: 20, fatG: null },
});

/** A deep copy that throws on any later mutation. */
export const deepFrozen = <T>(value: T): T => {
  const copy = structuredClone(value);
  const freeze = (node: unknown) => {
    if (node && typeof node === "object") {
      Object.values(node).forEach(freeze);
      Object.freeze(node);
    }
  };
  freeze(copy);
  return copy;
};
