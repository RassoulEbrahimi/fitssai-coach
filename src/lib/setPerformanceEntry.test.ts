import { describe, expect, it } from "vitest";
import {
  formatPerformancePair,
  formatRecordedSet,
  formatWeightKg,
  formatWeightNumber,
  parseActualRepsInput,
  parseActualWeightInput,
  REPS_ENTRY_ERROR,
  WEIGHT_ENTRY_ERROR,
} from "./setPerformanceEntry";

describe("parseActualRepsInput", () => {
  it.each([["12", 12], ["0", 0], [" 8 ", 8], ["999", 999]])("accepts %j", (text, value) => {
    expect(parseActualRepsInput(text)).toEqual({ ok: true, value });
  });

  it("reads blank as not recorded rather than as 0", () => {
    expect(parseActualRepsInput("")).toEqual({ ok: true, value: null });
    expect(parseActualRepsInput("   ")).toEqual({ ok: true, value: null });
  });

  it.each(["-1", "8,5", "8.5", "1000", "abc", "1e2", "Infinity", "NaN", "12 Wdh", "+3", "0x10"])(
    "refuses %j instead of reinterpreting it", (text) => {
      expect(parseActualRepsInput(text)).toEqual({ ok: false, error: REPS_ENTRY_ERROR });
    }
  );
});

describe("parseActualWeightInput", () => {
  it.each([
    ["52,5", 52.5],
    ["52.5", 52.5],
    ["50", 50],
    ["0,5", 0.5],
    ["52,25", 52.25],
    ["52,50", 52.5],
    ["1000", 1000],
  ])("normalizes %j to %s kg", (text, value) => {
    expect(parseActualWeightInput(text)).toEqual({ ok: true, value });
  });

  it("reads blank as not recorded, never as 0 kg", () => {
    expect(parseActualWeightInput("")).toEqual({ ok: true, value: null });
  });

  it.each(["0", "0,0", "-5", "52,555", "1.000", "1000,5", "52,", ",5", "5 2", "abc", "Infinity", "NaN", "1e3", "52kg", "52,5,5"])(
    "refuses %j instead of reinterpreting it", (text) => {
      expect(parseActualWeightInput(text)).toEqual({ ok: false, error: WEIGHT_ENTRY_ERROR });
    }
  );
});

describe("German kilogram formatting", () => {
  it("shows kilograms without trailing zeros or float noise", () => {
    expect(formatWeightKg(50)).toBe("50 kg");
    expect(formatWeightKg(52.5)).toBe("52,5 kg");
    expect(formatWeightKg(52.25)).toBe("52,25 kg");
    expect(formatWeightNumber(0.1 + 0.2)).toBe("0,3");
    expect(formatWeightNumber(1000)).toBe("1000");
  });

  it("describes a recorded set with only what was recorded", () => {
    expect(formatRecordedSet({ setNumber: 1, reps: 10, weightKg: 52.5, completed: true })).toBe("Satz 1 · 10 Wdh. · 52,5 kg");
    expect(formatRecordedSet({ setNumber: 2, reps: 8, weightKg: null, completed: true })).toBe("Satz 2 · 8 Wdh.");
    expect(formatRecordedSet({ setNumber: 3, reps: null, weightKg: 55, completed: true })).toBe("Satz 3 · 55 kg");
    expect(formatRecordedSet({ setNumber: 4, reps: 0, weightKg: null, completed: false })).toBe("Satz 4 · 0 Wdh. · offen");
  });

  it("pairs reps and weight compactly, and names a single value", () => {
    expect(formatPerformancePair({ reps: 10, weightKg: 52.5 })).toBe("10 × 52,5 kg");
    expect(formatPerformancePair({ reps: 0, weightKg: 20 })).toBe("0 × 20 kg");
    expect(formatPerformancePair({ reps: 8, weightKg: null })).toBe("8 Wdh.");
    expect(formatPerformancePair({ reps: null, weightKg: 50 })).toBe("50 kg");
    expect(formatPerformancePair({ reps: null, weightKg: null })).toBe("");
  });
});
