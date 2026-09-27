import { addNutritionDays, type NutritionPlanContent, type NutritionSlotId } from "../../../shared/nutrition";
import type { NutritionGenerationInput, NutritionInitialSlotConfiguration } from "../nutrition/generationInput";
import type {
  NutritionGenerationProviderRegistry,
  NutritionPlanProvider,
  NutritionPlanRepairRequest,
} from "../nutrition/generationProvider";
import { FIXTURE_REJECTED_MEAL_NAME } from "./fixturePlanValidationPolicies";

/**
 * TEST FIXTURES ONLY — not a Nutrition generator.
 *
 * A deterministic stand-in behind the generation seam, so the NUT-11
 * lifecycle (claim, candidate checks, one repair, finalisation, staleness,
 * takeover) runs end to end while production has no generator at all. It makes
 * no network call and has no prompt, no model and no secret: every answer is
 * built from the minimized input it is given, by a fixed script. Meal names
 * and values mean nothing.
 *
 * `src/testing/` is excluded from the Functions build, so this file is never
 * compiled into `lib/` or deployed, and a boundary test proves no production
 * module imports it.
 */

/**
 * What one call answers:
 *
 *   valid      plan content for exactly the input's dates and slots
 *   malformed  something that is not plan content
 *   mismatched valid plan content, a day off the requested start
 *   rejected   valid content with the meal name the fixture name policy rejects
 *   throws     the call fails
 *   pending    the call waits until the test calls `release`
 */
export type FakeProviderStep = "valid" | "malformed" | "mismatched" | "rejected" | "throws" | "pending";

export interface FakeProviderScript {
  generate: FakeProviderStep;
  /** The repair's answer; `null` offers no repair at all. Default `valid`. */
  repair?: FakeProviderStep | null;
}

/** Plan content for `startDate` and `slotOrder`: deterministic, arbitrary, meaningless. */
export const fixtureGeneratedContent = (
  startDate: string,
  slotOrder: readonly NutritionSlotId[],
  mealName = (slotId: string, dayIndex: number) => `Generated ${slotId} ${dayIndex}`
): NutritionPlanContent => ({
  startDate,
  endDate: addNutritionDays(startDate, 6),
  slotOrder: [...slotOrder],
  days: Array.from({ length: 7 }, (_, dayIndex) => ({
    date: addNutritionDays(startDate, dayIndex),
    meals: slotOrder.map((slotId, slotIndex) => ({
      mealId: `g-${dayIndex}-${slotIndex}`,
      slotId,
      name: mealName(slotId, dayIndex),
      values: { kcal: 300 + dayIndex + slotIndex, proteinG: 20, carbsG: 30, fatG: 10 },
    })),
  })),
});

const answerFor = (step: Exclude<FakeProviderStep, "pending">, input: NutritionGenerationInput): unknown => {
  switch (step) {
    case "valid":
      return fixtureGeneratedContent(input.startDate, input.slotOrder);
    case "malformed":
      return { startDate: input.startDate, days: "not a week", planId: "chosen-by-the-provider" };
    case "mismatched":
      return fixtureGeneratedContent(addNutritionDays(input.startDate, 1), input.slotOrder);
    case "rejected":
      return fixtureGeneratedContent(input.startDate, input.slotOrder, () => FIXTURE_REJECTED_MEAL_NAME);
    case "throws":
      throw new Error("fixture provider failure: secret-looking detail sk-live-000");
  }
};

export interface FakeNutritionPlanProvider extends NutritionPlanProvider {
  /** Copies of what each call received. */
  readonly calls: { generate: NutritionGenerationInput[]; repair: NutritionPlanRepairRequest[] };
  /** Resolves when a `pending` call has been made. */
  whenPending(): Promise<void>;
  /** Answers the waiting `pending` call. */
  release(step?: Exclude<FakeProviderStep, "pending">): void;
}

export const createFakeNutritionPlanProvider = (script: FakeProviderScript): FakeNutritionPlanProvider => {
  const calls = { generate: [] as NutritionGenerationInput[], repair: [] as NutritionPlanRepairRequest[] };
  let pendingCalled: () => void = () => undefined;
  const called = new Promise<void>((resolve) => (pendingCalled = resolve));
  let answerPending: (step: Exclude<FakeProviderStep, "pending">) => void = () => {
    throw new Error("no call is pending");
  };

  const run = async (step: FakeProviderStep, input: NutritionGenerationInput): Promise<unknown> => {
    if (step !== "pending") return answerFor(step, input);
    const released = new Promise<Exclude<FakeProviderStep, "pending">>((resolve) => (answerPending = resolve));
    pendingCalled();
    return answerFor(await released, input);
  };

  const repairStep = script.repair === undefined ? "valid" : script.repair;
  return {
    id: "test-fixture-generator",
    calls,
    generate: async (input) => {
      calls.generate.push(structuredClone(input));
      return run(script.generate, input);
    },
    ...(repairStep === null
      ? {}
      : {
          repair: async (request: NutritionPlanRepairRequest) => {
            calls.repair.push(structuredClone(request));
            return run(repairStep, request.input);
          },
        }),
    whenPending: () => called,
    release: (step = "valid") => answerPending(step),
  };
};

/** Test timing only: a lease short enough to expire in a test. Not an operational decision. */
export const FIXTURE_OPERATION_LEASE_MS = 60_000;

export const fixtureGenerationProviderRegistry = (
  provider: NutritionPlanProvider,
  operationLeaseMs = FIXTURE_OPERATION_LEASE_MS
): NutritionGenerationProviderRegistry => ({ current: () => ({ provider, operationLeaseMs }) });

/**
 * A fixture first-plan slot mapping: always breakfast, lunch and dinner. It
 * reads nothing and is NOT a meals-per-day rule.
 */
export const FIXTURE_INITIAL_SLOTS: NutritionInitialSlotConfiguration = Object.freeze({
  slotsFor: () => ["breakfast", "lunch", "dinner"] as const,
});
