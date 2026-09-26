import { describe, it, expect } from "vitest";
import {
  NUTRITION_SLOT_IDS,
  extraEntryId,
  isExtraEntryId,
  isNutritionDocId,
  isNutritionSlotId,
  isSlotEntryId,
  parseEntryId,
  parseSlotHeadId,
  slotEntryId,
  slotHeadId,
  type NutritionSlotId,
} from "@shared/nutrition";

const UUID = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";

describe("slot ids", () => {
  it("are stable ids, free of the composite-id separators", () => {
    for (const slotId of NUTRITION_SLOT_IDS) {
      expect(slotId).toMatch(/^[a-z]+$/);
      expect(isNutritionSlotId(slotId)).toBe(true);
    }
  });

  it.each(["Frühstück", "Breakfast", "Montag", "monday", "", "breakfast:1"])("rejects %j", (value) => {
    expect(isNutritionSlotId(value)).toBe(false);
  });
});

describe("slotEntryId", () => {
  it("is slot:{date}:{slotId}", () => {
    expect(slotEntryId("2026-03-29", "breakfast")).toBe("slot:2026-03-29:breakfast");
  });

  it("is deterministic", () => {
    expect(slotEntryId("2026-10-25", "dinner")).toBe(slotEntryId("2026-10-25", "dinner"));
  });

  it("differs by date and by slot", () => {
    const ids = new Set([
      slotEntryId("2026-10-25", "dinner"),
      slotEntryId("2026-10-26", "dinner"),
      slotEntryId("2026-10-25", "lunch"),
    ]);
    expect(ids.size).toBe(3);
  });

  it.each([
    ["2026-02-30", "lunch"],
    ["25.10.2026", "lunch"],
    ["2026-10-25", "Mittagessen"],
    ["2026-10-25", "sunday"],
  ])("rejects %j / %j", (date, slotId) => {
    expect(() => slotEntryId(date, slotId as NutritionSlotId)).toThrow(RangeError);
  });

  it("round-trips through parseEntryId", () => {
    expect(parseEntryId(slotEntryId("2026-03-29", "snack"))).toEqual({
      kind: "slot",
      date: "2026-03-29",
      slotId: "snack",
    });
  });
});

describe("extraEntryId", () => {
  it("is extra:{uuid}", () => {
    expect(extraEntryId(UUID)).toBe(`extra:${UUID}`);
  });

  it("is deterministic and case-canonical", () => {
    expect(extraEntryId(UUID.toUpperCase())).toBe(extraEntryId(UUID));
  });

  it.each(["", "not-a-uuid", "3f2b8c1e9a4d4e6f8b217c5d0e9a1b34", `${UUID}0`, "breakfast"])(
    "rejects %j",
    (value) => {
      expect(() => extraEntryId(value)).toThrow(RangeError);
    }
  );

  it("round-trips through parseEntryId", () => {
    expect(parseEntryId(extraEntryId(UUID))).toEqual({ kind: "extra", uuid: UUID });
  });
});

describe("parseEntryId", () => {
  it.each([
    "slot:2026-02-30:lunch",
    "slot:2026-03-29:Frühstück",
    "slot:2026-03-29:lunch:extra",
    "slot:2026-03-29",
    `extra:${UUID.toUpperCase()}`,
    "extra:",
    "meal:2026-03-29:lunch",
    `${UUID}`,
  ])("rejects %j", (value) => {
    expect(parseEntryId(value)).toBeNull();
  });

  it("tells the two kinds apart", () => {
    expect(isSlotEntryId("slot:2026-03-29:lunch")).toBe(true);
    expect(isExtraEntryId("slot:2026-03-29:lunch")).toBe(false);
    expect(isExtraEntryId(`extra:${UUID}`)).toBe(true);
    expect(isSlotEntryId(`extra:${UUID}`)).toBe(false);
  });
});

describe("slotHeadId", () => {
  it("is {planId}__{date}__{slotId}", () => {
    expect(slotHeadId("aB3dE5gH7jK9mN1pQ2rS", "2026-10-25", "lunch")).toBe(
      "aB3dE5gH7jK9mN1pQ2rS__2026-10-25__lunch"
    );
  });

  it("is deterministic", () => {
    expect(slotHeadId(UUID, "2026-10-25", "lunch")).toBe(slotHeadId(UUID, "2026-10-25", "lunch"));
  });

  it("is scoped by plan, date and slot", () => {
    const ids = new Set([
      slotHeadId("plan-a", "2026-10-25", "lunch"),
      slotHeadId("plan-b", "2026-10-25", "lunch"),
      slotHeadId("plan-a", "2026-10-26", "lunch"),
      slotHeadId("plan-a", "2026-10-25", "dinner"),
    ]);
    expect(ids.size).toBe(4);
  });

  it.each([
    ["", "2026-10-25", "lunch"],
    ["plan__a", "2026-10-25", "lunch"],
    ["plan_a", "2026-10-25", "lunch"],
    ["plan/a", "2026-10-25", "lunch"],
    ["Mein Plan", "2026-10-25", "lunch"],
    ["x".repeat(129), "2026-10-25", "lunch"],
    ["plan-a", "2026-02-30", "lunch"],
    ["plan-a", "2026-10-25", "Sonntag"],
  ])("rejects %j / %j / %j", (planId, date, slotId) => {
    expect(() => slotHeadId(planId, date, slotId as NutritionSlotId)).toThrow(RangeError);
  });

  it("round-trips through parseSlotHeadId", () => {
    expect(parseSlotHeadId(slotHeadId(UUID, "2026-03-29", "breakfast"))).toEqual({
      planId: UUID,
      date: "2026-03-29",
      slotId: "breakfast",
    });
  });

  it.each(["plan-a__2026-10-25", "plan-a__2026-10-25__lunch__x", "plan-a__2026-02-30__lunch", "__2026-10-25__lunch"])(
    "parseSlotHeadId rejects %j",
    (value) => {
      expect(parseSlotHeadId(value)).toBeNull();
    }
  );

  it("accepts Firestore auto-ids and UUIDs as document ids", () => {
    expect(isNutritionDocId("aB3dE5gH7jK9mN1pQ2rS")).toBe(true);
    expect(isNutritionDocId(UUID)).toBe(true);
  });
});
