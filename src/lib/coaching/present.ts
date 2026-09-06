import type { CoachingSuggestion } from "./suggestions";
import type { DurationCoverage, HistoryCoverage } from "./facts";

/**
 * German presentation for the deterministic coaching layer.
 *
 * Kept apart from the rules so the engine can be tested on codes and numbers
 * rather than on prose. Every string here is filled from facts the engine
 * produced — nothing states more than was measured, and nothing is attributed
 * to a model, because no model is involved.
 */

const formatNumber = (value: string | number | undefined): string =>
  typeof value === "number"
    ? Number.isInteger(value) ? String(value) : value.toLocaleString("de-DE", { maximumFractionDigits: 1 })
    : String(value ?? "");

export const suggestionText = (suggestion: CoachingSuggestion): string => {
  const p = suggestion.params ?? {};

  switch (suggestion.code) {
    case "no-data":
      return "Noch keine Trainingsdaten für diese Woche.";

    case "plan-finished":
      return "Dein Vier-Wochen-Plan ist abgeschlossen. Ein guter Moment, den nächsten vorzubereiten.";

    case "adherence-high":
      return `Stark: ${formatNumber(p.completed)} von ${formatNumber(p.scheduled)} Trainingstagen abgeschlossen.`;

    case "adherence-partial":
      return `${formatNumber(p.completed)} von ${formatNumber(p.scheduled)} Trainingstagen abgeschlossen.`;

    case "adherence-low":
      return `${formatNumber(p.completed)} von ${formatNumber(p.scheduled)} Trainingstagen abgeschlossen. Konzentriere dich zunächst auf regelmäßige Einheiten, bevor du den Umfang erhöhst.`;

    case "progression-weight":
      return `${p.exercise}: Gewicht von ${formatNumber(p.previous)} auf ${formatNumber(p.current)} kg gesteigert. Bestätige die neue Belastung zunächst in einer weiteren Einheit.`;

    case "progression-reps":
      return `${p.exercise}: ${formatNumber(p.current)} statt ${formatNumber(p.previous)} Wiederholungen.`;

    case "progression-sets":
      return `${p.exercise}: ${formatNumber(p.current)} statt ${formatNumber(p.previous)} Sätze abgeschlossen.`;

    case "volume-reduced":
      return `${p.exercise}: ${formatNumber(p.current)} statt ${formatNumber(p.previous)} Sätze abgeschlossen.`;

    case "frequency-mismatch":
      return `Dein Plan enthält ${formatNumber(p.scheduled)} Trainingstage, angegeben hast du ${formatNumber(p.preferred)} Tage pro Woche. Behalte das für den nächsten Plan im Blick.`;

    case "session-length-mismatch":
      return p.coverage === "partial"
        ? `Gemessen wurden im Schnitt ${formatNumber(p.measured)} Minuten pro Einheit, gewünscht sind ${formatNumber(p.preferred)}. Nicht jede Einheit wurde erfasst.`
        : `Gemessen wurden im Schnitt ${formatNumber(p.measured)} Minuten pro Einheit, gewünscht sind ${formatNumber(p.preferred)}.`;
  }
};

/** "1 Std. 15 Min." — whole minutes, never a fabricated figure. */
export const formatDuration = (seconds: number): string => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} Min.`;
  return minutes === 0 ? `${hours} Std.` : `${hours} Std. ${minutes} Min.`;
};

/** What to show for the week's measured time, given how much was measured. */
export const durationText = (coverage: DurationCoverage): string => {
  switch (coverage.state) {
    case "none":
      return "Dauer nicht erfasst";
    case "partial":
      // A floor, and labelled as one.
      return `mind. ${formatDuration(coverage.measuredDurationSec)}`;
    case "full":
      return formatDuration(coverage.measuredDurationSec);
  }
};

/**
 * How much of the week the duration above actually covers.
 *
 * Only shown when it is a floor. Naming both counts is what turns "teilweise
 * erfasst" from a disclaimer into a number the reader can act on — a week with
 * one of three sessions timed reads very differently from two of three, and
 * the tile above cannot show the difference on its own.
 */
export const durationCaption = (coverage: DurationCoverage): string | null => {
  if (coverage.state !== "partial") return null;
  const total = coverage.measuredSessionCount + coverage.unmeasuredSessionCount;
  return `${coverage.measuredSessionCount} von ${total} Einheiten erfasst`;
};

/**
 * A note about incomplete older records, in plain German.
 *
 * Deliberately says nothing about documents, schemas or migrations — that is
 * our problem, not the user's. Shown only when it actually limits a number on
 * screen.
 */
export const historyNote = (history: HistoryCoverage): string | null =>
  history.state === "partial"
    ? "Für ältere Trainingseinträge sind nicht alle Details verfügbar."
    : null;
