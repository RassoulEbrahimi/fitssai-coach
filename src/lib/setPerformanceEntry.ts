import {
  isRecordedReps,
  isRecordedWeightKg,
  MAX_RECORDED_REPS,
  MAX_RECORDED_WEIGHT_KG,
} from "@/lib/setPerformance";

/**
 * Typing and showing recorded set performance.
 *
 * Entry is German-friendly: `52,5` and `52.5` are the same load. Anything that
 * cannot be read exactly is refused with a reason rather than rounded,
 * truncated or guessed - `1.000` is not quietly 1 kg, `8,5` reps are not 8.
 * Blank means "not recorded", never 0.
 *
 * Prescription text is formatted elsewhere (`setPrescription.ts`) and is not
 * touched here.
 */

export type ParsedPerformanceEntry =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

const REPS = /^\d{1,3}$/;
const WEIGHT = /^\d{1,4}(?:[.,]\d{1,2})?$/;

export const REPS_ENTRY_ERROR = `Wiederholungen als ganze Zahl von 0 bis ${MAX_RECORDED_REPS} eingeben.`;
export const WEIGHT_ENTRY_ERROR =
  `Gewicht in kg über 0 und bis ${MAX_RECORDED_WEIGHT_KG} eingeben, z. B. 52,5.`;

export const parseActualRepsInput = (text: string): ParsedPerformanceEntry => {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = REPS.test(trimmed) ? Number(trimmed) : Number.NaN;
  return isRecordedReps(value) ? { ok: true, value } : { ok: false, error: REPS_ENTRY_ERROR };
};

export const parseActualWeightInput = (text: string): ParsedPerformanceEntry => {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = WEIGHT.test(trimmed) ? Number(trimmed.replace(",", ".")) : Number.NaN;
  return isRecordedWeightKg(value) ? { ok: true, value } : { ok: false, error: WEIGHT_ENTRY_ERROR };
};

const KILOGRAMS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2, useGrouping: false });

/** `52,5`, `50` - the number as an input shows it. */
export const formatWeightNumber = (kg: number): string => KILOGRAMS.format(kg);

/** `52,5 kg`, `50 kg`. */
export const formatWeightKg = (kg: number): string => `${formatWeightNumber(kg)} kg`;

export interface RecordedSetLine {
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  completed: boolean;
}

/** `10 Wdh. · 52,5 kg`, naming only the values present. Empty when there are none. */
export const formatPerformanceValues = (values: { reps: number | null; weightKg: number | null }): string =>
  [
    values.reps !== null ? `${values.reps} Wdh.` : null,
    values.weightKg !== null ? formatWeightKg(values.weightKg) : null,
  ].filter((part): part is string => part !== null).join(" · ");

/**
 * `10 × 52,5 kg`, the compact form shown beside a set's inputs. With only one
 * value recorded it falls back to `formatPerformanceValues`, which names it.
 */
export const formatPerformancePair = (values: { reps: number | null; weightKg: number | null }): string =>
  values.reps !== null && values.weightKg !== null
    ? `${values.reps} × ${formatWeightKg(values.weightKg)}`
    : formatPerformanceValues(values);

/**
 * `Satz 1 · 10 Wdh. · 52,5 kg`, naming only what was recorded. A set that was
 * recorded but not ticked says so, rather than passing for a completed one.
 */
export const formatRecordedSet = (set: RecordedSetLine): string =>
  [
    `Satz ${set.setNumber}`,
    formatPerformanceValues(set) || null,
    set.completed ? null : "offen",
  ].filter((part): part is string => part !== null).join(" · ");
