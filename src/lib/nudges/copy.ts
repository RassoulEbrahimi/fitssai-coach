/**
 * Nudge wording.
 *
 * Deterministic German, written here and nowhere else. No model produces or
 * rewrites a single word of it: a reminder that a planned session is still
 * open is arithmetic over stored records, and paying for a generation to say
 * so would spend the weekly-review AI quota on a sentence that never varies.
 *
 * The tone rules are part of the contract and are asserted in the tests:
 *
 *   - no obligation ("Du musst", "Du solltest"),
 *   - no streak, no guilt, no praise for showing up,
 *   - no claim about motivation, fatigue, recovery or why a day was skipped,
 *   - no promise that anything arrives while the app is closed.
 *
 * Every sentence states a fact the app can prove from the user's own data, and
 * leaves the decision with the user.
 */

/** How the day's session stands, as far as stored records can show. */
export type DayNudgeKind = "planned-session-today" | "unfinished-session";

export interface NudgeText {
  title: string;
  body: string;
}

/** The one truthful statement about delivery: nothing arrives while closed. */
export const NUDGE_DELIVERY_NOTE =
  "Hinweise erscheinen, solange die App geöffnet ist.";

/** Today's session, with nothing logged against it yet. */
export const PLANNED_SESSION_TEXT: NudgeText = {
  title: "Heute ist eine Trainingseinheit geplant.",
  body: "Wenn es heute für dich passt, kannst du deinen Plan öffnen.",
};

/**
 * Today's session, with at least one exercise already ticked off.
 *
 * "Noch offen" is a statement about the day session record, not about effort:
 * ticking exercises never completes a day, so this stays accurate for someone
 * who logged half a session and for someone who logged all of it without
 * finishing the day.
 */
export const UNFINISHED_SESSION_TEXT: NudgeText = {
  title: "Deine heutige Einheit ist noch offen.",
  body: "Du kannst deinen Plan öffnen und dort weitermachen.",
};

export const dayNudgeText = (kind: DayNudgeKind): NudgeText =>
  kind === "unfinished-session" ? UNFINISHED_SESSION_TEXT : PLANNED_SESSION_TEXT;

/**
 * The week in counted sessions.
 *
 * "Offen" — not "verpasst": a planned day later in the week has not been
 * missed, and this module cannot know why an earlier one was not logged. Only
 * the two numbers are stated; no reading of them is offered, and nothing is
 * recommended.
 */
export const weeklyConsistencyText = (open: number, scheduled: number): NudgeText => ({
  title: `Diese Woche sind noch ${open} von ${scheduled} geplanten Einheiten offen.`,
  body: "Gezählt werden abgeschlossene Einheiten aus deinem Plan.",
});
