/**
 * Legacy Nutrition: the read-only compatibility model for
 * `users/{uid}/nutrition_plans/{id}`.
 *
 * Legacy is not Nutrition V2 and never becomes it. Its production schema has
 * never been inventoried, so the stored document is treated as unknown input:
 * this module reads what it can display and ignores the rest. It never writes,
 * never repairs the stored document, never invents meals, never assigns ids or
 * slots, never adds a schemaVersion and never computes totals or macros.
 *
 * Nothing here imports the V2 contracts, and nothing converts a legacy plan
 * into a V2 plan. The two share no persistence model.
 */

/** One meal as the compatibility display shows it. Text only. */
export interface LegacyNutritionMeal {
  /** The stored `meal` name, or "" when it is missing or not displayable. */
  meal: string;
  /** The stored `description`, or "" when it is missing or not displayable. */
  description: string;
  /**
   * The stored `calories` as display text, or null when there is nothing safe
   * to show. Deliberately a string: a legacy calorie value is shown next to its
   * meal and nothing more — it is never a V2 nutrition value or part of a total.
   */
  caloriesText: string | null;
}

/** One stored content key (for example `breakfast`) and its displayable meals. */
export interface LegacyNutritionMealBucket {
  /** The stored key, untouched. Labels and order belong to the display. */
  key: string;
  meals: LegacyNutritionMeal[];
}

export interface LegacyNutritionPlan {
  /** Firestore document id of the legacy plan. */
  id: string;
  /** Displayable buckets in stored order; malformed buckets are left out. */
  buckets: LegacyNutritionMealBucket[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const displayText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const caloriesText = (value: unknown): string | null => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  return null;
};

/** A stored meal item, or null when it has nothing a person could read. */
const readLegacyMeal = (item: unknown): LegacyNutritionMeal | null => {
  if (!isRecord(item)) return null;
  const meal = displayText(item.meal);
  const description = displayText(item.description);
  if (meal.trim() === "" && description.trim() === "") return null;
  return { meal, description, caloriesText: caloriesText(item.calories) };
};

/**
 * Reads the displayable buckets out of a stored legacy `content` value.
 *
 * Accepts anything and never throws. A bucket that is not an array, or has no
 * displayable meal, is ignored; so is a meal item that is not an object or has
 * neither a name nor a description. The input is only read, never changed.
 */
export const readLegacyNutritionBuckets = (content: unknown): LegacyNutritionMealBucket[] => {
  if (!isRecord(content)) return [];
  const buckets: LegacyNutritionMealBucket[] = [];
  for (const [key, items] of Object.entries(content)) {
    if (!Array.isArray(items)) continue;
    const meals: LegacyNutritionMeal[] = [];
    for (const item of items) {
      const meal = readLegacyMeal(item);
      if (meal) meals.push(meal);
    }
    if (meals.length > 0) buckets.push({ key, meals });
  }
  return buckets;
};

/**
 * The display-only adapter for one legacy `nutrition_plans` document.
 * `data` is the raw Firestore document data, whatever shape it has.
 */
export const toLegacyNutritionPlan = (id: string, data: unknown): LegacyNutritionPlan => ({
  id,
  buckets: readLegacyNutritionBuckets(isRecord(data) ? data.content : undefined),
});

/** How many displayable meals a legacy plan has. A count, not a nutrition total. */
export const countLegacyNutritionMeals = (plan: LegacyNutritionPlan): number =>
  plan.buckets.reduce((sum, bucket) => sum + bucket.meals.length, 0);
