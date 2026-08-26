import { describe, it, expect } from "vitest";
import {
  DAYS_PER_WEEK_MAX,
  DAYS_PER_WEEK_MIN,
  EQUIPMENT_OPTIONS,
  EQUIPMENT_TYPES,
  NOT_SPECIFIED,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  daysPerWeekSchema,
  equipmentLabel,
  equipmentSchema,
  formatDaysPerWeek,
  formatEquipment,
  formatSessionMinutes,
  isEquipmentType,
  parseCoachingPreferences,
  sessionMinutesSchema,
} from "./coachingPreferences";

describe("equipment taxonomy", () => {
  it.each(EQUIPMENT_TYPES)("%s is a valid selection", (id) => {
    expect(equipmentSchema.safeParse([id]).success).toBe(true);
    expect(isEquipmentType(id)).toBe(true);
  });

  it("offers a German label for every id, with no duplicates", () => {
    expect(EQUIPMENT_OPTIONS).toHaveLength(EQUIPMENT_TYPES.length);

    const ids = EQUIPMENT_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of EQUIPMENT_TYPES) {
      expect(equipmentLabel(id)).not.toBe(id);
      expect(equipmentLabel(id).length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown equipment value", () => {
    expect(equipmentSchema.safeParse(["moon_boots"]).success).toBe(false);
    expect(isEquipmentType("moon_boots")).toBe(false);
    expect(isEquipmentType(undefined)).toBe(false);
  });

  it("requires at least one selection on a new submission", () => {
    expect(equipmentSchema.safeParse([]).success).toBe(false);
    expect(equipmentSchema.safeParse(["bodyweight"]).success).toBe(true);
  });

  it("lets full_gym stand alone", () => {
    // Someone with gym access should not have to tick every machine.
    expect(equipmentSchema.safeParse(["full_gym"]).success).toBe(true);
  });
});

describe("daysPerWeek", () => {
  it("accepts the bounds", () => {
    expect(daysPerWeekSchema.safeParse(DAYS_PER_WEEK_MIN).success).toBe(true);
    expect(daysPerWeekSchema.safeParse(DAYS_PER_WEEK_MAX).success).toBe(true);
    expect(DAYS_PER_WEEK_MIN).toBe(1);
    expect(DAYS_PER_WEEK_MAX).toBe(7);
  });

  it.each([0, 8, -1, 3.5, Number.NaN, "3", null, undefined])(
    "rejects %s",
    (value) => {
      expect(daysPerWeekSchema.safeParse(value).success).toBe(false);
    }
  );
});

describe("sessionMinutes", () => {
  it("accepts the bounds", () => {
    expect(sessionMinutesSchema.safeParse(SESSION_MINUTES_MIN).success).toBe(true);
    expect(sessionMinutesSchema.safeParse(SESSION_MINUTES_MAX).success).toBe(true);
    expect(SESSION_MINUTES_MIN).toBe(15);
    expect(SESSION_MINUTES_MAX).toBe(180);
  });

  it.each([14, 181, 0, -30, 45.5, "45", null])("rejects %s", (value) => {
    expect(sessionMinutesSchema.safeParse(value).success).toBe(false);
  });

  it("is a preference in minutes, never a measurement in seconds", () => {
    // PR47 stores measured `durationSec`. A 45-minute session is 2700s; feeding
    // that number in as a preference must not validate.
    expect(sessionMinutesSchema.safeParse(2700).success).toBe(false);
    expect(sessionMinutesSchema.safeParse(45).success).toBe(true);
  });
});

describe("parseCoachingPreferences", () => {
  it("reads a complete document", () => {
    expect(
      parseCoachingPreferences({
        equipment: ["dumbbells", "pullup_bar"],
        daysPerWeek: 4,
        sessionMinutes: 60,
      })
    ).toEqual({
      equipment: ["dumbbells", "pullup_bar"],
      daysPerWeek: 4,
      sessionMinutes: 60,
    });
  });

  it("leaves a legacy profile with none of the fields readable", () => {
    expect(parseCoachingPreferences({ fullName: "A", age: 30 })).toEqual({
      equipment: undefined,
      daysPerWeek: undefined,
      sessionMinutes: undefined,
    });
  });

  it("survives a null or undefined document", () => {
    expect(parseCoachingPreferences(null)).toEqual({});
    expect(parseCoachingPreferences(undefined)).toEqual({});
  });

  it("drops unknown equipment ids instead of rendering them", () => {
    const parsed = parseCoachingPreferences({
      equipment: ["dumbbells", "moon_boots", 42, null],
    });

    expect(parsed.equipment).toEqual(["dumbbells"]);
  });

  it("treats an array of only unknown ids as no answer", () => {
    expect(parseCoachingPreferences({ equipment: ["moon_boots"] }).equipment).toBeUndefined();
  });

  it("de-duplicates repeated ids", () => {
    expect(
      parseCoachingPreferences({ equipment: ["barbell", "barbell"] }).equipment
    ).toEqual(["barbell"]);
  });

  it("treats an out-of-range number as absent rather than clamping it", () => {
    // Clamping would invent an answer the user never gave.
    const parsed = parseCoachingPreferences({ daysPerWeek: 9, sessionMinutes: 5 });

    expect(parsed.daysPerWeek).toBeUndefined();
    expect(parsed.sessionMinutes).toBeUndefined();
  });

  it("does not crash on malformed values", () => {
    expect(() =>
      parseCoachingPreferences({ equipment: "dumbbells", daysPerWeek: {}, sessionMinutes: [] })
    ).not.toThrow();
  });
});

describe("display formatting", () => {
  it("says so plainly when nothing was ever given", () => {
    expect(formatEquipment(undefined)).toBe(NOT_SPECIFIED);
    expect(formatEquipment([])).toBe(NOT_SPECIFIED);
    expect(formatDaysPerWeek(undefined)).toBe(NOT_SPECIFIED);
    expect(formatSessionMinutes(undefined)).toBe(NOT_SPECIFIED);
  });

  it("formats real values in German", () => {
    expect(formatEquipment(["dumbbells", "kettlebell"])).toBe("Kurzhanteln, Kettlebell");
    expect(formatDaysPerWeek(1)).toBe("1 Tag pro Woche");
    expect(formatDaysPerWeek(4)).toBe("4 Tage pro Woche");
    expect(formatSessionMinutes(45)).toBe("45 Minuten");
  });
});
