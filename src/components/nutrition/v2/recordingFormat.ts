import type { RecordedEntry } from "@shared/nutrition";

/**
 * Display text for recorded Nutrition V2 entries. Recorded values are
 * estimates, so they are shown rounded and as "ca."; the stored values stay
 * unrounded.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const formatNutritionKcal = (kcal: number, language: string): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(Math.round(kcal));

export const formatNutritionPortion = (portion: number, language: string): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(portion);

/** What an entry records, in one line. A tombstone reads as "not recorded". */
export const recordedEntryLabel = (entry: RecordedEntry, t: Translate, language: string): string => {
  if (entry.status !== "active") return t("nutritionV2.recording.state.none");
  switch (entry.recording) {
    case "skip":
      return t("nutritionV2.recording.state.skip");
    case "plannedMeal": {
      const kcal = formatNutritionKcal(entry.nutritionEstimate.kcal, language);
      return entry.portion === 1
        ? t("nutritionV2.recording.state.plannedMeal", { kcal })
        : t("nutritionV2.recording.state.plannedMealPortion", {
            portion: formatNutritionPortion(entry.portion, language),
            kcal,
          });
    }
    case "custom": {
      const kcal = formatNutritionKcal(entry.nutritionEstimate.kcal, language);
      return entry.kind === "extra"
        ? t("nutritionV2.recording.state.extra", { kcal })
        : t("nutritionV2.recording.state.custom", { name: entry.name, kcal });
    }
  }
};
