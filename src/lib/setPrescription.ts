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

export const formatSetTarget = (reps: number | string | null | undefined, weight?: string | null): SetTargetText => {
  const target = typeof reps === "number"
    ? (Number.isFinite(reps) ? String(reps) : "")
    : String(reps ?? "").trim();
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
