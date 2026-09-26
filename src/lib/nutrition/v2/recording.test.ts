import { describe, expect, it } from "vitest";
import { recordedEntrySnapshotSchema, slotEntryId, type RecordedEntrySnapshot } from "@shared/nutrition";
import {
  NUTRITION_PORTION_PRESETS,
  NutritionRecordingInputError,
  buildCustomSlotRecording,
  buildExtraRecording,
  buildNutritionEntryIntent,
  buildPlannedMealRecording,
  buildSkipRecording,
  isRecordableNutritionDate,
  nutritionEntryOpFor,
  parseNutritionNumberInput,
} from "./recording";
import { resolveNutritionDay, type ResolvedNutritionMeal } from "./resolvedPlan";
import { buildNutritionDayRecordings } from "./dayRecordings";
import {
  aiOverride,
  customSlotEntry,
  deepFrozen,
  extraEntry,
  intentUuid,
  makePlan,
  makeSlotHead,
  plannedMealEntry,
  removedEntry,
  skipEntry,
} from "@/test/nutritionV2Fixtures";

/*
  NUT-06. Recording builders snapshot exactly what the person confirmed, once:
  a resolved planned meal times the chosen portion (unrounded), an explicit
  skip, or a custom meal with stated kcal and unknown macros kept unknown. An
  extra entry's identity is its UUID, never its name.
*/

const DATE = "2026-09-26";
const plan = makePlan();

const resolvedMeal = (slotId: "breakfast" | "lunch" | "dinner", heads = [] as ReturnType<typeof makeSlotHead>[]) => {
  const day = resolveNutritionDay(plan, heads, DATE);
  const meal = day?.meals.find((candidate) => candidate.slotId === slotId);
  if (!meal) throw new Error("fixture has no meal");
  return meal;
};

describe("buildPlannedMealRecording", () => {
  it("snapshots a resolved base meal: plan, date, slot, name, portion and values", () => {
    const meal = resolvedMeal("lunch");
    expect(meal.source).toBe("base");

    expect(buildPlannedMealRecording(meal, 1)).toEqual({
      schemaVersion: 2,
      entryId: slotEntryId(DATE, "lunch"),
      kind: "slot",
      date: DATE,
      slotId: "lunch",
      recording: "plannedMeal",
      planId: plan.planId,
      name: meal.name,
      estimateBasis: "planMealTimesPortion",
      portion: 1,
      nutritionEstimate: meal.values,
    });
  });

  it("snapshots a resolved override the same way — its name and its values", () => {
    const meal = resolvedMeal("lunch", [makeSlotHead(DATE, "lunch", aiOverride("Linsen-Curry", 900))]);
    expect(meal.source).toBe("override");

    const recorded = buildPlannedMealRecording(meal, 1);
    expect(recorded).toMatchObject({ name: "Linsen-Curry", planId: plan.planId, nutritionEstimate: { kcal: 900, proteinG: 30, carbsG: 110, fatG: 25 } });
    expect(recordedEntrySnapshotSchema.parse(recorded)).toEqual(recorded);
  });

  it.each([
    [0.5, { kcal: 700.2 * 0.5 + 3 * 0.5, proteinG: 20, carbsG: 40, fatG: 10 }],
    [1.5, { kcal: (700.2 + 3) * 1.5, proteinG: 60, carbsG: 120, fatG: 30 }],
  ])("scales every nutrient by a %s portion", (portion, expected) => {
    // Day 3 (2026-09-26) adds 3 kcal to each planned meal.
    const recorded = buildPlannedMealRecording(resolvedMeal("lunch"), portion);
    expect(recorded.recording === "plannedMeal" && recorded.portion).toBe(portion);
    const estimate = recorded.nutritionEstimate as Record<string, number>;
    for (const [key, value] of Object.entries(expected)) expect(estimate[key]).toBeCloseTo(value, 10);
  });

  it("keeps stored values unrounded", () => {
    const recorded = buildPlannedMealRecording(resolvedMeal("breakfast"), 0.75);
    // 403.4 × 0.75 = 302.55 — not rounded to 303 or 302.6.
    expect(recorded.nutritionEstimate?.kcal).toBe(403.4 * 0.75);
    expect(Number.isInteger(recorded.nutritionEstimate?.kcal)).toBe(false);
  });

  it("accepts any finite portion above zero, not just the presets", () => {
    expect(NUTRITION_PORTION_PRESETS).toEqual([0.5, 0.75, 1, 1.5]);
    for (const portion of [0.1, 1.3, 2, 3.75]) {
      expect(buildPlannedMealRecording(resolvedMeal("lunch"), portion)).toMatchObject({ portion });
    }
  });

  it.each([0, -0.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a portion of %s", (portion) => {
    expect(() => buildPlannedMealRecording(resolvedMeal("lunch"), portion)).toThrow(NutritionRecordingInputError);
  });

  it("is not changed by a later change to the plan", () => {
    const livePlan = structuredClone(plan);
    const day = resolveNutritionDay(livePlan, [], DATE);
    const meal = day?.meals[1] as ResolvedNutritionMeal;
    const recorded = buildPlannedMealRecording(meal, 1);
    const before = structuredClone(recorded);

    const planMeal = livePlan.days[3].meals.find((m) => m.slotId === "lunch");
    if (!planMeal) throw new Error("fixture");
    planMeal.name = "Geändert";
    planMeal.values.kcal = 9999;
    meal.values.kcal = 9999;

    expect(recorded).toEqual(before);
  });

  it("is not changed by a later change to the slot's override", () => {
    const head = makeSlotHead(DATE, "lunch", aiOverride("Linsen-Curry", 900));
    const meal = resolvedMeal("lunch", [head]);
    const recorded = buildPlannedMealRecording(meal, 1);
    const before = structuredClone(recorded);

    if (head.selection.kind === "override") {
      head.selection.override.meal.name = "Ofengemüse";
      head.selection.override.meal.values.kcal = 400;
    }
    if (meal.source === "override") meal.override.meal.values.kcal = 400;

    expect(recorded).toEqual(before);
  });

  it("does not mutate the resolved meal", () => {
    const meal = deepFrozen(resolvedMeal("dinner"));
    expect(() => buildPlannedMealRecording(meal, 1.5)).not.toThrow();
  });
});

describe("buildSkipRecording", () => {
  it("has no estimate and the slot's deterministic id", () => {
    expect(buildSkipRecording({ date: DATE, slotId: "breakfast" })).toEqual({
      schemaVersion: 2,
      entryId: `slot:${DATE}:breakfast`,
      kind: "slot",
      date: DATE,
      slotId: "breakfast",
      recording: "skip",
      estimateBasis: "none",
      nutritionEstimate: null,
    });
  });
});

describe("custom recordings", () => {
  it("need stated kcal", () => {
    for (const kcal of [undefined, null] as unknown as number[]) {
      expect(() => buildCustomSlotRecording({ date: DATE, slotId: "dinner", name: "Pizza", estimate: { kcal } })).toThrow(
        NutritionRecordingInputError
      );
    }
  });

  it("keep stated-null macros null and never zero a missing macro", () => {
    const recorded = buildCustomSlotRecording({
      date: DATE,
      slotId: "dinner",
      name: "Pizza",
      estimate: { kcal: 950, proteinG: null, carbsG: 110 },
    });
    expect(recorded.nutritionEstimate).toEqual({ kcal: 950, proteinG: null, carbsG: 110, fatG: null });
    expect(recorded).toMatchObject({ recording: "custom", estimateBasis: "userStated", entryId: `slot:${DATE}:dinner` });
  });

  it("accept 0 kcal: no calorie floor is invented", () => {
    expect(buildCustomSlotRecording({ date: DATE, slotId: "dinner", name: "Wasser", estimate: { kcal: 0 } }).nutritionEstimate).toEqual({
      kcal: 0,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("refuse %s for kcal or a macro", (bad) => {
    expect(() => buildCustomSlotRecording({ date: DATE, slotId: "dinner", name: "Pizza", estimate: { kcal: bad } })).toThrow(
      NutritionRecordingInputError
    );
    expect(() =>
      buildExtraRecording({ uuid: intentUuid(5), date: DATE, name: "Apfel", estimate: { kcal: 80, fatG: bad } })
    ).toThrow(NutritionRecordingInputError);
  });

  it("need a name, stored trimmed", () => {
    expect(() => buildCustomSlotRecording({ date: DATE, slotId: "dinner", name: "   ", estimate: { kcal: 1 } })).toThrow(
      NutritionRecordingInputError
    );
    expect(buildCustomSlotRecording({ date: DATE, slotId: "dinner", name: "  Pizza ", estimate: { kcal: 1 } })).toMatchObject({
      name: "Pizza",
    });
  });
});

describe("buildExtraRecording", () => {
  const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("uses extra:{uuid} as identity, with no slot", () => {
    expect(buildExtraRecording({ uuid: UUID, date: DATE, name: "Apfel", estimate: { kcal: 80 } })).toMatchObject({
      entryId: `extra:${UUID}`,
      kind: "extra",
      slotId: null,
      recording: "custom",
    });
  });

  it("gives a different UUID a different entry, and the name never decides identity", () => {
    const a = buildExtraRecording({ uuid: UUID, date: DATE, name: "Apfel", estimate: { kcal: 80 } });
    const b = buildExtraRecording({ uuid: intentUuid(7), date: DATE, name: "Apfel", estimate: { kcal: 80 } });
    const renamed = buildExtraRecording({ uuid: UUID, date: DATE, name: "Birne", estimate: { kcal: 80 } });

    expect(a.entryId).not.toBe(b.entryId);
    expect(renamed.entryId).toBe(a.entryId);
    expect(a.entryId).not.toMatch(/apfel/i);
  });

  it("refuses something that is not a UUID", () => {
    expect(() => buildExtraRecording({ uuid: "Apfel", date: DATE, name: "Apfel", estimate: { kcal: 80 } })).toThrow();
  });
});

describe("intents", () => {
  const lunch = plannedMealEntry(DATE, "lunch");
  const desired = buildPlannedMealRecording(resolvedMeal("lunch"), 0.5);

  it("records over nothing with expected revision 0", () => {
    expect(buildNutritionEntryIntent({ kind: "save", current: null, desired }, intentUuid(9))).toEqual({
      intentId: intentUuid(9),
      entryId: lunch.entryId,
      expectedRevision: 0,
      op: "record",
      desired,
    });
  });

  it("corrects an active entry at the revision the person saw", () => {
    expect(buildNutritionEntryIntent({ kind: "save", current: { ...lunch, revision: 4 }, desired }, intentUuid(9))).toMatchObject({
      op: "correct",
      expectedRevision: 4,
    });
  });

  it("records or skips again over a tombstone, at its revision", () => {
    const tombstone = removedEntry(lunch);
    expect(buildNutritionEntryIntent({ kind: "save", current: tombstone, desired }, intentUuid(9))).toMatchObject({
      op: "record",
      expectedRevision: 2,
    });
    expect(nutritionEntryOpFor(tombstone, buildSkipRecording({ date: DATE, slotId: "lunch" }))).toBe("skip");
    expect(nutritionEntryOpFor(null, buildSkipRecording({ date: DATE, slotId: "lunch" }))).toBe("skip");
    expect(nutritionEntryOpFor(skipEntry(DATE, "lunch"), desired)).toBe("correct");
  });

  it("removes at the current revision", () => {
    expect(buildNutritionEntryIntent({ kind: "remove", current: { ...lunch, revision: 3 } }, intentUuid(9))).toEqual({
      intentId: intentUuid(9),
      entryId: lunch.entryId,
      expectedRevision: 3,
      op: "remove",
    });
  });

  it("refuses a current entry that is another entry", () => {
    expect(() =>
      buildNutritionEntryIntent({ kind: "save", current: plannedMealEntry(DATE, "dinner"), desired }, intentUuid(9))
    ).toThrow(NutritionRecordingInputError);
  });
});

describe("recordable dates", () => {
  it("allows today and earlier days, never a future day, and sets no lower bound", () => {
    expect(isRecordableNutritionDate(DATE, DATE)).toBe(true);
    expect(isRecordableNutritionDate("2026-09-25", DATE)).toBe(true);
    expect(isRecordableNutritionDate("2020-01-01", DATE)).toBe(true);
    expect(isRecordableNutritionDate("2026-09-27", DATE)).toBe(false);
    expect(isRecordableNutritionDate("2027-01-01", DATE)).toBe(false);
    expect(isRecordableNutritionDate("2026-02-30", DATE)).toBe(false);
  });
});

describe("parseNutritionNumberInput", () => {
  it("reads digits with a comma or point, and empty as not stated", () => {
    expect(parseNutritionNumberInput("12,5")).toEqual({ valid: true, value: 12.5 });
    expect(parseNutritionNumberInput(" 80 ")).toEqual({ valid: true, value: 80 });
    expect(parseNutritionNumberInput("0.75")).toEqual({ valid: true, value: 0.75 });
    expect(parseNutritionNumberInput("")).toEqual({ valid: true, value: null });
    expect(parseNutritionNumberInput("   ")).toEqual({ valid: true, value: null });
  });

  it("refuses anything else rather than guessing", () => {
    for (const text of ["-1", "abc", "1e3", "1,2,3", "Infinity", "NaN", "1.", ",5", "12 kcal"]) {
      expect(parseNutritionNumberInput(text), text).toEqual({ valid: false });
    }
  });
});

describe("buildNutritionDayRecordings", () => {
  const day = resolveNutritionDay(plan, [], DATE);
  if (!day) throw new Error("fixture");

  it("pairs each resolved slot with its entry, and reads a tombstone as not recorded", () => {
    const tombstone = removedEntry(plannedMealEntry(DATE, "breakfast"));
    const recordings = buildNutritionDayRecordings(day, [
      tombstone,
      skipEntry(DATE, "lunch"),
      customSlotEntry(DATE, "dinner"),
      plannedMealEntry("2026-09-25", "dinner"),
    ]);

    expect(recordings.slots.map((slot) => [slot.meal.slotId, slot.entry?.recording ?? null, slot.active?.recording ?? null])).toEqual([
      ["breakfast", "plannedMeal", null],
      ["lunch", "skip", "skip"],
      ["dinner", "custom", "custom"],
    ]);
    // The tombstone stays available: its revision is what the next write names.
    expect(recordings.slots[0].entry).toBe(tombstone);
    expect(recordings.slots[0].meal.values).toEqual(day.meals[0].values);
  });

  it("lists active extras of the date only", () => {
    const active = extraEntry(DATE, "9b2d8f5e-1c3a-4e7b-9a6d-2f4c8e1b3a5d");
    const removed = removedEntry(extraEntry(DATE));
    const recordings = buildNutritionDayRecordings(day, [removed, active, extraEntry("2026-09-25", intentUuid(3))]);

    expect(recordings.extras).toEqual([active]);
    expect(recordings.slots.every((slot) => slot.active === null)).toBe(true);
  });

  it("never puts a recorded value into the planned meal", () => {
    const recordings = buildNutritionDayRecordings(day, [plannedMealEntry(DATE, "lunch", { kcal: 5000, proteinG: 1, carbsG: 1, fatG: 1 })]);
    expect(recordings.slots[1].meal.values.kcal).toBe(day.meals[1].values.kcal);
    expect(day.planned).toEqual(resolveNutritionDay(plan, [], DATE)?.planned);
  });

  it("returns snapshots a recording action can use as they are", () => {
    const snapshot: RecordedEntrySnapshot = buildPlannedMealRecording(day.meals[0], 1);
    expect(recordedEntrySnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});
