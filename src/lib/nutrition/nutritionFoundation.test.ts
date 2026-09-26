import { describe, it, expect } from "vitest";
import {
  NUTRITION_LEGACY_PLANS_COLLECTION,
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_ENABLED,
  NUTRITION_V2_SUGGESTIONS_COLLECTION,
} from "@shared/nutrition";

describe("Nutrition V2 feature flag", () => {
  it("is off", () => {
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });
});

describe("Nutrition collection names", () => {
  it("are the canonical V2 names", () => {
    expect(NUTRITION_V2_COLLECTIONS).toEqual({
      state: "nutrition_v2_state",
      targets: "nutrition_v2_targets",
      plans: "nutrition_v2_plans",
      slots: "nutrition_v2_slots",
      entries: "nutrition_v2_entries",
      generations: "nutrition_v2_generations",
    });
    expect(NUTRITION_V2_SUGGESTIONS_COLLECTION).toBe("_nutrition_v2_suggestions");
    expect(Object.isFrozen(NUTRITION_V2_COLLECTIONS)).toBe(true);
  });

  it("never reuse the legacy collection", () => {
    expect(NUTRITION_LEGACY_PLANS_COLLECTION).toBe("nutrition_plans");
    expect(Object.values(NUTRITION_V2_COLLECTIONS)).not.toContain(NUTRITION_LEGACY_PLANS_COLLECTION);
    expect(NUTRITION_V2_SUGGESTIONS_COLLECTION).not.toBe(NUTRITION_LEGACY_PLANS_COLLECTION);
  });
});
