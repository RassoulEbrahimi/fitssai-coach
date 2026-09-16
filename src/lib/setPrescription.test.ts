import { describe, expect, it } from "vitest";
import { formatSetTarget, formatSetTargetPlaceholders } from "./setPrescription";

describe("formatSetTargetPlaceholders", () => {
  it.each([
    [12, "50 kg", { reps: "12", weight: "50", complete: true }],
    ["10", "60kg", { reps: "10", weight: "60", complete: true }],
    ["8–12", "52,5 kg", { reps: "8–12", weight: "52,5", complete: true }],
    ["8 - 12", "12.5 kg", { reps: "8-12", weight: "12,5", complete: true }],
    ["10–15", "20", { reps: "10–15", weight: "20", complete: true }],
    ["12", "112,5 kg", { reps: "12", weight: "112,5", complete: true }],
  ])("hints %j × %j", (reps, weight, expected) => {
    expect(formatSetTargetPlaceholders(reps, weight)).toEqual(expected);
  });

  it("gives no weight hint without a load and still counts as complete", () => {
    expect(formatSetTargetPlaceholders(15)).toEqual({ reps: "15", complete: true });
    expect(formatSetTargetPlaceholders("15", "  ")).toEqual({ reps: "15", complete: true });
    expect(formatSetTargetPlaceholders(undefined, undefined)).toEqual({ complete: true });
  });

  it.each([
    ["a load in words", "Körpergewicht"],
    ["a load range", "100–120 kg"],
    ["a percentage", "70%"],
    ["another unit", "45 lbs"],
    ["an implement count", "2x 10 kg"],
    ["0 kg", "0 kg"],
    ["more than the recordable maximum", "1500 kg"],
    ["too many decimals", "52,555 kg"],
  ])("never turns %s into a weight hint", (_label, weight) => {
    const hints = formatSetTargetPlaceholders(10, weight);

    expect(hints.weight).toBeUndefined();
    expect(hints.reps).toBe("10");
    expect(hints.complete).toBe(false);
  });

  it.each([
    ["a time", "30 Sekunden"],
    ["AMRAP", "AMRAP"],
    ["a range too long for the field", "100–150"],
    ["a decimal", "8.5"],
  ])("never turns %s into a reps hint", (_label, reps) => {
    const hints = formatSetTargetPlaceholders(reps, "20 kg");

    expect(hints.reps).toBeUndefined();
    expect(hints.weight).toBe("20");
    expect(hints.complete).toBe(false);
  });

  it("ignores a non-finite count", () => {
    expect(formatSetTargetPlaceholders(Number.NaN)).toEqual({ complete: true });
  });
});

describe("formatSetTarget", () => {
  it("still writes the prescription out as the plan has it", () => {
    expect(formatSetTarget(12, "50 kg")).toEqual({ visual: "12 × 50 kg", spoken: "12 Wiederholungen mit 50 kg" });
    expect(formatSetTarget("30 Sekunden")).toEqual({ visual: "30 Sekunden", spoken: "30 Sekunden" });
    expect(formatSetTarget(6, "Körpergewicht")).toEqual({ visual: "6 × Körpergewicht", spoken: "6 Wiederholungen mit Körpergewicht" });
    expect(formatSetTarget(undefined)).toEqual({ visual: "", spoken: "keine Vorgabe" });
  });
});
