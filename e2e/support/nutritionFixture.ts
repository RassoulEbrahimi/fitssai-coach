import {
  NUTRITION_PLAN_DAY_COUNT,
  addNutritionDays,
  type NutritionDate,
  type NutritionPlanContent,
  type NutritionSlotId,
  type NutritionValues,
} from "../../shared/nutrition";

/**
 * The deterministic LOCAL test data of the Nutrition E2E harness (NUT-13A).
 *
 * Emulator data only — this is not a migration and nothing here is ever
 * written to a real project. Pure: no Firebase, no clock.
 *
 * The TARGET of a populated account is not written here. The seed asks the
 * real `nutritionSetTarget` callable for it, so it is exactly what the signed
 * `calculated-target` v1 policy computes from the profile below. The plan's
 * meals are then derived from that target, and the real activation
 * transaction accepts them only if the signed `target-alignment` v1 policy
 * does.
 */

export type E2EUserKey = "adult" | "isolation" | "missingAge" | "minor";

export interface E2EUser {
  key: E2EUserKey;
  /** Fixed, so every reset reproduces the same account ids. */
  uid: string;
  /** A reserved `.test` domain: never deliverable, never a real person's address. */
  email: string;
  /** The profile document, `users/{uid}`, as onboarding and the Nutrition profile section write it. */
  profile: Record<string, unknown>;
  /** A populated account gets a target and an active plan; the others only a profile. */
  nutrition: null | { planId: string; targetRequestId: string; catalog: MealCatalog };
}

/** Three names per day per slot, one day after another. */
export type MealCatalog = Record<"breakfast" | "lunch" | "dinner", readonly string[]>;

/** The slots of every E2E plan: three meals a day, in day order. */
export const E2E_SLOT_ORDER: readonly NutritionSlotId[] = ["breakfast", "lunch", "dinner"];

const ADULT_CATALOG: MealCatalog = {
  breakfast: [
    "Haferflocken mit Beeren",
    "Rührei mit Vollkornbrot",
    "Skyr mit Walnüssen",
    "Overnight Oats mit Apfel",
    "Quark mit Banane",
    "Vollkornbrot mit Hüttenkäse",
    "Porridge mit Birne",
  ],
  lunch: [
    "Hähnchen mit Reis und Brokkoli",
    "Linsensuppe mit Brot",
    "Vollkornpasta mit Tomatensauce",
    "Putenwrap mit Salat",
    "Chili sin Carne",
    "Lachs mit Kartoffeln",
    "Kichererbsen-Bowl",
  ],
  dinner: [
    "Ofengemüse mit Feta",
    "Rinderhack-Pfanne mit Paprika",
    "Tofu-Curry mit Reis",
    "Omelett mit Blattsalat",
    "Kartoffelauflauf",
    "Seelachs mit Gemüse",
    "Bohnen-Eintopf",
  ],
};

/** Deliberately no name in common with the adult's plan, so isolation checks can tell them apart. */
const ISOLATION_CATALOG: MealCatalog = {
  breakfast: [
    "Müsli mit Joghurt",
    "Buchweizen-Pfannkuchen",
    "Chia-Pudding mit Mango",
    "Toast mit Avocado",
    "Hirsebrei mit Zimt",
    "Joghurt mit Granola",
    "Dinkelbrötchen mit Ei",
  ],
  lunch: [
    "Gemüse-Risotto",
    "Couscous-Salat mit Minze",
    "Spinat-Lasagne",
    "Falafel mit Hummus",
    "Kürbissuppe mit Kernen",
    "Quinoa mit Ofengemüse",
    "Nudelsalat mit Pesto",
  ],
  dinner: [
    "Gefüllte Paprika",
    "Zucchini-Frittata",
    "Tomatensuppe mit Brot",
    "Pilzpfanne mit Polenta",
    "Linsen-Dal",
    "Blumenkohl-Curry",
    "Süßkartoffel mit Quark",
  ],
};

const completeProfile = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  fullName: "E2E Testperson",
  experienceLevel: "beginner",
  equipment: ["dumbbells"],
  daysPerWeek: 3,
  sessionMinutes: 45,
  dietaryPreference: "noPreference",
  mealsPerDay: 3,
  ...overrides,
});

export const E2E_USERS: Readonly<Record<E2EUserKey, E2EUser>> = Object.freeze({
  // A: the populated adult every NUT-13A/NUT-13B flow starts from.
  adult: {
    key: "adult",
    uid: "e2e-nutrition-adult",
    email: "nutrition-adult@fitssai-e2e.test",
    profile: completeProfile({
      fullName: "E2E Erwachsene Person A",
      age: 34,
      height: 180,
      weight: 80,
      biologicalSex: "male",
      fitnessGoal: "maintain",
      activityLevel: "moderatelyActive",
    }),
    nutrition: {
      planId: "e2e-plan-adult",
      targetRequestId: "0e2e0000-0000-4000-8000-00000000000a",
      catalog: ADULT_CATALOG,
    },
  },
  // B: a second populated adult, for account isolation.
  isolation: {
    key: "isolation",
    uid: "e2e-nutrition-isolation",
    email: "nutrition-isolation@fitssai-e2e.test",
    profile: completeProfile({
      fullName: "E2E Erwachsene Person B",
      age: 29,
      height: 168,
      weight: 62,
      biologicalSex: "female",
      fitnessGoal: "loseFat",
      activityLevel: "lightlyActive",
      dietaryPreference: "vegetarian",
    }),
    nutrition: {
      planId: "e2e-plan-isolation",
      targetRequestId: "0e2e0000-0000-4000-8000-00000000000b",
      catalog: ISOLATION_CATALOG,
    },
  },
  // C: every Nutrition answer except the age.
  missingAge: {
    key: "missingAge",
    uid: "e2e-nutrition-missing-age",
    email: "nutrition-missing-age@fitssai-e2e.test",
    profile: completeProfile({
      fullName: "E2E Ohne Alter",
      height: 175,
      weight: 70,
      biologicalSex: "female",
      fitnessGoal: "maintain",
      activityLevel: "sedentary",
    }),
    nutrition: null,
  },
  // D: a minor — Nutrition V2 is for adults only.
  minor: {
    key: "minor",
    uid: "e2e-nutrition-minor",
    email: "nutrition-minor@fitssai-e2e.test",
    profile: completeProfile({
      fullName: "E2E Minderjährig",
      age: 16,
      height: 170,
      weight: 60,
      biologicalSex: "male",
      fitnessGoal: "gainMuscle",
      activityLevel: "veryActive",
    }),
    nutrition: null,
  },
});

/**
 * Today sits in the middle of the week, so the seeded week has past days,
 * today and future days. Recording and replacement are offered for today only.
 */
export const E2E_PLAN_DAYS_BEFORE_TODAY = 3;

export const e2ePlanStartDate = (today: NutritionDate): NutritionDate => addNutritionDays(today, -E2E_PLAN_DAYS_BEFORE_TODAY);

/** Share of the day's TARGET each meal carries. Sums to 1. */
const SLOT_SHARES: Record<"breakfast" | "lunch" | "dinner", number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.4 };

/**
 * Each day's size relative to the TARGET. Every day stays well inside the
 * policy's daily 90–110 %, and the seven average exactly 100 %.
 */
export const E2E_DAY_FACTORS: readonly number[] = [1, 0.97, 1.03, 0.98, 1.02, 0.99, 1.01];

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * A meal's planned values: the TARGET's values times its share of the day and
 * the day's factor. Macros scale with kcal, so each day's macro energy stays
 * equal to its kcal (the target's own macros add up to its kcal). Rounded to
 * whole kcal and tenths of a gram, as a person would read a recipe.
 */
const mealValues = (target: NutritionValues, share: number, factor: number): NutritionValues => ({
  kcal: round(target.kcal * share * factor, 0),
  proteinG: round(target.proteinG * share * factor, 1),
  carbsG: round(target.carbsG * share * factor, 1),
  fatG: round(target.fatG * share * factor, 1),
});

/** The base content of an E2E plan: 7 contiguous dates from `startDate`, three meals each. */
export const buildE2EPlanContent = (
  target: NutritionValues,
  startDate: NutritionDate,
  catalog: MealCatalog,
  planKey: string
): NutritionPlanContent => ({
  startDate,
  endDate: addNutritionDays(startDate, NUTRITION_PLAN_DAY_COUNT - 1),
  slotOrder: [...E2E_SLOT_ORDER],
  days: E2E_DAY_FACTORS.map((factor, dayIndex) => ({
    date: addNutritionDays(startDate, dayIndex),
    meals: (["breakfast", "lunch", "dinner"] as const).map((slotId) => ({
      mealId: `${planKey}-d${dayIndex + 1}-${slotId}`,
      slotId,
      name: catalog[slotId][dayIndex],
      values: mealValues(target, SLOT_SHARES[slotId], factor),
    })),
  })),
});
