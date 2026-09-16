import { isRecordedWeightKg } from "@/lib/setPerformance";
import { formatWeightNumber } from "@/lib/setPerformanceEntry";

/**
 * How a set's prescribed reps are shown.
 *
 * A prescription is whatever the plan says — `10`, `"8–12"`, `"30 Sekunden"`,
 * `"AMRAP"` — and it is shown as written. Only a plain count or a plain count
 * range is a number of repetitions and gets the "Wdh" unit; anything else
 * already carries its own meaning and must not be turned into one.
 */

export interface SetTargetText {
  /** Short visible text, e.g. "8–12 Wdh", "10 × 40 kg", "30 Sekunden". */
  visual: string;
  /** Spoken form for an accessible name, e.g. "8–12 Wiederholungen mit 40 kg". */
  spoken: string;
}

const COUNT = /^\d+$/;
const COUNT_RANGE = /^\d+\s*[-–—]\s*\d+$/;

const readTarget = (reps: number | string | null | undefined): string =>
  typeof reps === "number"
    ? (Number.isFinite(reps) ? String(reps) : "")
    : String(reps ?? "").trim();

export const formatSetTarget = (reps: number | string | null | undefined, weight?: string | null): SetTargetText => {
  const target = readTarget(reps);
  const load = weight?.trim() || "";
  const isRepCount = COUNT.test(target) || COUNT_RANGE.test(target);

  if (!target) {
    return load
      ? { visual: load, spoken: `mit ${load}` }
      : { visual: "", spoken: "keine Vorgabe" };
  }

  const spokenTarget = isRepCount ? `${target} Wiederholungen` : target;
  if (load) {
    return { visual: `${target} × ${load}`, spoken: `${spokenTarget} mit ${load}` };
  }
  return { visual: isRepCount ? `${target} Wdh` : target, spoken: spokenTarget };
};

/**
 * Hints for a set's empty reps and kg fields, taken from the prescription.
 *
 * A hint is an input placeholder only: never a value, never saved, never a
 * completion. Only a plain count, a count range or a single load in kg becomes
 * one - `12`, `8–12`, `52,5`. Anything else (`30 Sekunden`, `AMRAP`,
 * `Körpergewicht`, `100–120 kg`) has to be written out, and `complete` is
 * false. No load, or a load of 0, gives no weight hint: 0 kg is never shown.
 */
export interface SetTargetPlaceholders {
  reps?: string;
  weight?: string;
  /** Every part of the prescription is carried by a hint. */
  complete: boolean;
}

const LOAD_KG = /^(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:kg)?$/i;
/** Longest hint that stays readable inside the compact fields. */
const MAX_HINT_LENGTH = 5;

export const formatSetTargetPlaceholders = (
  reps: number | string | null | undefined,
  weight?: string | null
): SetTargetPlaceholders => {
  const target = readTarget(reps);
  const load = weight?.trim() || "";
  const repsHint = COUNT.test(target) || COUNT_RANGE.test(target) ? target.replace(/\s+/g, "") : "";
  const kg = LOAD_KG.exec(load);
  const loadValue = kg ? Number(kg[1].replace(",", ".")) : Number.NaN;
  const weightHint = isRecordedWeightKg(loadValue) ? formatWeightNumber(loadValue) : "";
  const fits = (hint: string) => hint.length > 0 && hint.length <= MAX_HINT_LENGTH;

  return {
    ...(fits(repsHint) ? { reps: repsHint } : {}),
    ...(fits(weightHint) ? { weight: weightHint } : {}),
    complete: (!target || fits(repsHint)) && (!load || fits(weightHint)),
  };
};
