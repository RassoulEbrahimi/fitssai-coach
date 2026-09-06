import { z } from "zod";

/**
 * The weekly review contract, shared verbatim by the React client and the
 * Firebase Functions backend.
 *
 * Two things live here and nowhere else:
 *
 *  1. **The metrics.** Scheduled days, completed days, completion percentage
 *     and measured time are arithmetic over persisted records. They are
 *     computed here, by both sides, from the same inputs — never produced by a
 *     model, never sent up from a browser as an authoritative claim.
 *
 *  2. **The recommendation.** Which of the five categories a week falls into
 *     is decided by the rules below, deterministically. A model may later
 *     rephrase the wording; it may not choose the category and it may not
 *     touch a number.
 *
 * The hard product rule this file encodes: a recommendation is *advice*.
 * Nothing here edits, regenerates or reorders a plan, and no function in this
 * module returns anything a caller could persist as plan content.
 *
 * No React, no Firebase, no Node, no clock: a date-sensitive decision takes
 * its resolved week as an argument.
 */

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/** One day of the plan's week. A day with no exercises is a rest day. */
export interface ReviewPlanDay {
  dayIndex: number;
  exerciseCount: number;
}

/** A completion identified by plan position, never by date. */
export interface ReviewCompletion {
  weekKey: string;
  dayIndex: number;
  completed: boolean;
}

/** A stored day log, with the fields the review can use. */
export interface ReviewLog {
  weekKey?: string | null;
  dayIndex?: number | null;
  completed?: boolean | null;
  /** Measured seconds. Absent on every pre-PR47 document. */
  durationSec?: number | null;
}

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

export type DurationCoverageState = "none" | "partial" | "full";

/**
 * The week in numbers.
 *
 * Every field is either measured or explicitly absent. `null` means "we do not
 * know", and a caller must render it as such — 0/0 is not 0 %, and an
 * unmeasured session is not a zero-minute one.
 */
export interface WeeklyReviewMetrics {
  /** `"Week 1".."Week 4"`, or `""` when no plan covers the date. */
  weekKey: string;
  weekNumber: number | null;
  hasPlan: boolean;
  scheduledDays: number;
  completedDays: number;
  missedDays: number;
  /** 0–100, rounded. Null when nothing is scheduled. */
  completionPercent: number | null;
  /** Sum of measured seconds. Null when nothing was measured — never 0. */
  measuredDurationSec: number | null;
  /** Completed sessions that carry a measured length. */
  measuredSessionCount: number;
  /** Completed sessions that do not. Together they are `completedDays`. */
  unmeasuredSessionCount: number;
  durationCoverage: DurationCoverageState;
  /**
   * The week before, when the plan has one.
   *
   * Shapes which sentence leads, never which conclusion is drawn — see
   * `recommendFocus`.
   */
  previousWeek: { weekKey: string; completionPercent: number | null } | null;
}

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

/**
 * Positive, finite, plausible seconds — anything else is "not measured".
 *
 * Mirrors the client fact layer deliberately, and a test pins the two
 * together: a duration that one side counts and the other discards would put
 * two different totals on the same screen.
 */
export const usableDurationSec = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 12 * 60 * 60) return null;
  return Math.floor(value);
};

/**
 * Completion for one week of the plan.
 *
 * Rest days are not training days, so they are in neither the numerator nor
 * the denominator: a week with three training days reads "2 von 3", never
 * "2 von 7". A day counts as done only on canonical `weekKey` + `dayIndex`
 * evidence — a pre-PR47 log's date can be derived from the plan's creation
 * date rather than its start Monday, and using it would turn a known-bad value
 * into a confident weekly claim.
 */
export const computeWeekCompletion = (
  weekKey: string,
  planDays: readonly ReviewPlanDay[],
  completions: readonly ReviewCompletion[]
): {
  scheduledDays: number;
  completedDays: number;
  completionPercent: number | null;
  /** Plan positions of the completed training days, ascending. */
  completedDayIndexes: number[];
} => {
  const done = new Set(
    completions
      .filter((entry) => entry.completed && entry.weekKey === weekKey)
      .map((entry) => entry.dayIndex)
  );

  const trainingDays = planDays.filter((day) => day.exerciseCount > 0);
  const scheduledDays = trainingDays.length;
  const completedDayIndexes = trainingDays
    .filter((day) => done.has(day.dayIndex))
    .map((day) => day.dayIndex);
  const completedDays = completedDayIndexes.length;

  return {
    scheduledDays,
    completedDays,
    completionPercent:
      scheduledDays === 0 ? null : clampPercent((completedDays / scheduledDays) * 100),
    completedDayIndexes,
  };
};

export interface WeeklyReviewMetricsInput {
  weekKey: string;
  weekNumber: number | null;
  hasPlan: boolean;
  planDays: readonly ReviewPlanDay[];
  completions: readonly ReviewCompletion[];
  /** Logs of the reviewed week only. */
  weekLogs: readonly ReviewLog[];
  /** The preceding week, when the plan has one. */
  previousWeek?: {
    weekKey: string;
    planDays: readonly ReviewPlanDay[];
  } | null;
}

/** Assemble the week's metrics. Pure arithmetic over persisted records. */
export const computeWeeklyReviewMetrics = (
  input: WeeklyReviewMetricsInput
): WeeklyReviewMetrics => {
  const current = computeWeekCompletion(input.weekKey, input.planDays, input.completions);

  /*
    A session is one completed training day — not one log document.

    `workout_logs` holds two families of document for the same day: the day
    document, which is where `recordSessionDuration` puts `durationSec`, and
    one document per exercise, written when a set is ticked. Counting documents
    made a fully measured three-day week report "1 measured, 14 unmeasured" and
    label its own total a floor. So the length of a day is the longest usable
    measurement any of that day's documents carries, and coverage is counted
    over the days the week actually completed.

    The consequence is an invariant the wording depends on:
    `measuredSessionCount + unmeasuredSessionCount === completedDays`. "Partial"
    then means exactly what it says — some completed sessions were not timed —
    rather than "this week has more log rows than stopwatch readings".
  */
  const measurementByDay = new Map<number, number>();
  input.weekLogs.forEach((log) => {
    if (typeof log.dayIndex !== "number" || !Number.isInteger(log.dayIndex)) return;
    const seconds = usableDurationSec(log.durationSec);
    if (seconds === null) return;
    const known = measurementByDay.get(log.dayIndex);
    if (known === undefined || seconds > known) measurementByDay.set(log.dayIndex, seconds);
  });

  let measuredDurationSec = 0;
  let measuredSessionCount = 0;

  current.completedDayIndexes.forEach((dayIndex) => {
    const seconds = measurementByDay.get(dayIndex);
    if (seconds === undefined) return;
    measuredDurationSec += seconds;
    measuredSessionCount += 1;
  });

  const unmeasuredSessionCount = current.completedDays - measuredSessionCount;

  const durationCoverage: DurationCoverageState =
    measuredSessionCount === 0 ? "none" : unmeasuredSessionCount === 0 ? "full" : "partial";

  const previous = input.previousWeek
    ? {
        weekKey: input.previousWeek.weekKey,
        completionPercent: computeWeekCompletion(
          input.previousWeek.weekKey,
          input.previousWeek.planDays,
          input.completions
        ).completionPercent,
      }
    : null;

  return {
    weekKey: input.weekKey,
    weekNumber: input.weekNumber,
    hasPlan: input.hasPlan,
    scheduledDays: current.scheduledDays,
    completedDays: current.completedDays,
    missedDays: current.scheduledDays - current.completedDays,
    completionPercent: current.completionPercent,
    // Absent stays absent: "not measured" and "trained for no time" are
    // different statements, and only one of them is true here.
    measuredDurationSec: measuredSessionCount === 0 ? null : measuredDurationSec,
    measuredSessionCount,
    unmeasuredSessionCount,
    durationCoverage,
    previousWeek: previous,
  };
};

/* ------------------------------------------------------------------ *
 * The recommendation
 * ------------------------------------------------------------------ */

/**
 * What a week's recommendation is *about*.
 *
 * Three categories, and only three, because three is what this app's data can
 * support. Adherence — how many planned sessions were ticked off — is the only
 * training signal that is persisted. It says whether the plan was followed. It
 * says nothing about whether the plan was *right*: nothing here records
 * perceived effort, fatigue, recovery, sleep, injury status, why a session was
 * missed, or whether the week felt manageable.
 *
 * So there is no "increase" and no "reduce". A user who completed two full
 * weeks may be coasting or may be at their limit, and the difference is
 * invisible from this side; a user who missed most of a week may have an
 * unrealistic plan, or a broken boiler. Turning either into a workload verdict
 * would be a confident claim about a person from data that cannot carry one —
 * the same untruth as a fabricated metric, only harder to spot.
 */
export const RECOMMENDATION_CATEGORIES = [
  /** The week went broadly as planned. Keep going; change nothing. */
  "maintain",
  /** Sessions are open. Regularity is the next step, not volume. */
  "consistency",
  /**
   * The plan schedules all seven days. A fact about the plan, stated as one —
   * never a claim that the person needs rest, which this app cannot know.
   */
  "dense-schedule",
] as const;

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

/**
 * Which wording a category gets.
 *
 * The category is what the app concluded; the focus is which true sentence
 * leads. Splitting them is what lets the previous week shape the *wording*
 * without ever escalating the *conclusion* — two full weeks read differently
 * from one, but both are still "maintain".
 */
export const RECOMMENDATION_FOCUSES = [
  /** Nothing is scheduled for this week. */
  "no-plan",
  /** Nothing completed yet. Encouragement, no inference. */
  "first-session",
  /** Some done, several open. */
  "catch-up",
  /** Repeatedly few completed: a question about the schedule, not a verdict. */
  "schedule-fit",
  /** Most of the week done. */
  "on-track",
  /** Every planned session done. */
  "week-complete",
  /** Every planned session done, twice running. */
  "week-complete-repeat",
  /** Seven scheduled days, all completed. */
  "dense-schedule",
] as const;

export type RecommendationFocus = (typeof RECOMMENDATION_FOCUSES)[number];

/** Every focus belongs to exactly one category. */
export const FOCUS_CATEGORY: Readonly<Record<RecommendationFocus, RecommendationCategory>> =
  Object.freeze({
    "no-plan": "consistency",
    "first-session": "consistency",
    "catch-up": "consistency",
    "schedule-fit": "consistency",
    "on-track": "maintain",
    "week-complete": "maintain",
    "week-complete-repeat": "maintain",
    "dense-schedule": "dense-schedule",
  });

export interface WeeklyRecommendation {
  category: RecommendationCategory;
  headline: string;
  message: string;
  /** The numbers the category was derived from, in plain German. */
  reason: string;
  /**
   * Where the wording came from. `deterministic` is the rules in this file;
   * `ai` is a model rephrasing them. Never presented as the other.
   */
  source: "deterministic" | "ai";
}

/** Below this, regularity is the thing to work on. */
export const LOW_COMPLETION_PERCENT = 50;

/**
 * Which focus the week falls into.
 *
 * The only inputs are counts of completed and scheduled sessions. Read what
 * this deliberately does *not* do:
 *
 *  - Two full weeks do not become a recommendation to train more. They select
 *    a wording that mentions progression as something the reader may decide,
 *    conditional on how training feels — which the app does not measure and
 *    says so.
 *  - Repeated low completion does not become a recommendation to train less.
 *    It selects a wording that asks whether the schedule fits the reader's
 *    week, because "why" is precisely the thing no record here contains.
 *  - Seven scheduled days is reported as what it is: a dense plan. Not
 *    fatigue, not insufficient recovery, not a need to deload.
 */
export const recommendFocus = (metrics: WeeklyReviewMetrics): RecommendationFocus => {
  if (!metrics.hasPlan || metrics.scheduledDays === 0) return "no-plan";

  const percent = metrics.completionPercent ?? 0;
  const previous = metrics.previousWeek?.completionPercent ?? null;

  if (percent >= 100) {
    // A week the plan left no rest day in is worth naming, factually.
    if (metrics.scheduledDays >= 7) return "dense-schedule";
    return previous !== null && previous >= 100 ? "week-complete-repeat" : "week-complete";
  }

  // Nothing done at all gets encouragement and no reading of why.
  if (metrics.completedDays === 0) return "first-session";

  if (percent < LOW_COMPLETION_PERCENT) {
    return previous !== null && previous < LOW_COMPLETION_PERCENT ? "schedule-fit" : "catch-up";
  }

  return "on-track";
};

/** The category the week falls into. Derived from the focus, never separately. */
export const recommendCategory = (metrics: WeeklyReviewMetrics): RecommendationCategory =>
  FOCUS_CATEGORY[recommendFocus(metrics)];

/* ------------------------------------------------------------------ *
 * German copy for the deterministic recommendation
 * ------------------------------------------------------------------ */

/** "1 Std. 15 Min." — whole minutes over measured seconds, never an estimate. */
export const formatDurationDe = (seconds: number): string => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} Min.`;
  return minutes === 0 ? `${hours} Std.` : `${hours} Std. ${minutes} Min.`;
};

/**
 * The measured-time clause of a reason, or nothing.
 *
 * A partly measured week says so: the total is a floor across the sessions
 * that carry a length, not the week's actual time.
 */
const durationClause = (metrics: WeeklyReviewMetrics): string => {
  if (metrics.measuredDurationSec === null) return "";
  const total = formatDurationDe(metrics.measuredDurationSec);
  /*
    Partial coverage is named as such, with both counts, so the total reads as
    the floor it is. Full coverage says the plain number and no more — adding
    "aus 3 von 3" to a complete measurement is noise, and the difference
    between the two sentences is the point.
  */
  return metrics.durationCoverage === "partial"
    ? ` Gemessene Trainingszeit: mindestens ${total} — ${metrics.measuredSessionCount} von ${metrics.completedDays} abgeschlossenen Einheiten wurden gemessen.`
    : ` Gemessene Trainingszeit: ${total}.`;
};

const completionClause = (metrics: WeeklyReviewMetrics): string =>
  metrics.completionPercent === null
    ? "Für diese Woche sind keine Trainingstage geplant."
    : `${metrics.completedDays} von ${metrics.scheduledDays} Trainingstagen abgeschlossen (${metrics.completionPercent} %).`;

/**
 * The deterministic wording for a focus.
 *
 * Written so every sentence is either a count the app actually holds or an
 * explicit statement that the app does not know. Three things it never says,
 * because no record here supports them: that the reader is tired, that they
 * have recovered enough or too little, and that they are ready to train more
 * or ought to train less. Where progression or schedule size comes up at all,
 * it comes up as the reader's decision and is marked as one.
 *
 * And every variant leaves the plan alone, because the feature does.
 */
export const describeRecommendation = (metrics: WeeklyReviewMetrics): WeeklyRecommendation => {
  const focus = recommendFocus(metrics);
  const category = FOCUS_CATEGORY[focus];
  const reason = `Grundlage: ${completionClause(metrics)}${durationClause(metrics)}`;
  const wording = (headline: string, message: string): WeeklyRecommendation => ({
    category,
    headline,
    message,
    reason,
    source: "deterministic",
  });

  switch (focus) {
    case "no-plan":
      return wording(
        "Noch nichts geplant",
        "Für diese Woche sind keine Trainingstage hinterlegt. Sobald ein Plan aktiv ist, siehst du hier deinen Wochenfortschritt."
      );

    case "first-session":
      return wording(
        "Fang klein an",
        `Diese Woche ist noch keine deiner ${metrics.scheduledDays} geplanten Einheiten abgeschlossen. ` +
          "Eine einzelne Einheit ist ein guter nächster Schritt. Dein Plan bleibt dabei genau so, wie er ist."
      );

    case "catch-up":
      /*
        The open sessions are named, and nothing is demanded of them. "Catch up
        the rest" reads as an obligation the app is in no position to set: it
        does not know what else was in the week, and a plan is a proposal, not
        a debt. Regularity is offered as the useful next step instead, which is
        true regardless of why the sessions stayed open.
      */
      return wording(
        "Regelmäßigkeit zuerst",
        `Du hast ${metrics.completedDays} von ${metrics.scheduledDays} geplanten Einheiten abgeschlossen; ` +
          `${metrics.missedDays} ${metrics.missedDays === 1 ? "ist" : "sind"} noch offen. ` +
          "Für den Fortschritt zählt vor allem, dass du regelmäßig trainierst — ob du die offenen " +
          "Einheiten nachholst, entscheidest du. Dein Plan bleibt unverändert."
      );

    case "schedule-fit":
      /*
        A question, not a verdict. The app knows how many sessions were ticked
        off and nothing else — not why the others were not, and not whether the
        week was too much. Saying "reduce your workload" here would be an
        inference the records cannot carry, so the reader is handed the
        question instead of an answer.
      */
      return wording(
        "Passt der Wochenplan zu deiner Woche?",
        "In dieser und der vorigen Woche sind mehrere geplante Einheiten offen geblieben. " +
          "Woran das lag, weiß die App nicht. Vielleicht ist es ein guter Moment, selbst zu prüfen, " +
          "ob die geplanten Tage zu deinem Alltag passen."
      );

    case "on-track":
      /*
        Most of the week is done, which is worth saying plainly. What is not
        said: that the remaining sessions must happen. The count is a fact; an
        instruction to complete it would be a judgement about a week the app
        cannot see.
      */
      return wording(
        "Du bist auf Kurs",
        `${metrics.completedDays} von ${metrics.scheduledDays} geplanten Einheiten sind abgeschlossen, ` +
          `${metrics.missedDays} ${metrics.missedDays === 1 ? "ist" : "sind"} noch offen. ` +
          "Der aktuelle Umfang passt zu dem, was du diese Woche geschafft hast — daran musst du nichts ändern."
      );

    case "week-complete":
      /*
        100 % is acknowledged as exactly what it is: every planned session was
        ticked off. Not that the plan was easy, not that it was hard, and not
        that anything about it should now change.
      */
      return wording(
        "Woche vollständig abgeschlossen",
        `Du hast alle ${metrics.scheduledDays} geplanten Einheiten dieser Woche abgeschlossen. ` +
          "Für die nächste Woche bleibt dein Plan genau so — eine vollständige Woche ist ein guter Grund, nichts zu ändern."
      );

    case "week-complete-repeat":
      /*
        Two full weeks is an adherence fact, not a readiness one. The app
        counts completed sessions; it does not know how they felt, and the
        wording says exactly that rather than reading progress into a tally.
      */
      return wording(
        "Zwei vollständige Wochen",
        "Du hast diese und die vorige Woche vollständig abgeschlossen. Wenn sich dein Training über " +
          "mehrere Wochen weiterhin gut anfühlt, kannst du selbst entscheiden, ob du später etwas " +
          "verändern möchtest — die App zählt abgeschlossene Einheiten und kann nicht beurteilen, " +
          "wie sich dein Training anfühlt."
      );

    case "dense-schedule":
      /*
        The observation is about the plan: seven training days, no rest day.
        What that means for this person is not something a completion tally can
        answer, and the sentence declines to pretend otherwise.
      */
      return wording(
        "Dein Plan sieht sieben Trainingstage vor",
        "Diese Woche enthält dein Plan an allen sieben Tagen eine Einheit, und du hast alle abgeschlossen. " +
          "Das ist ein dichter Wochenplan. Ob ein fester Ruhetag für dich passt, entscheidest du — die App " +
          "kann das nicht beurteilen."
      );
  }
};

/**
 * Whether this week is worth asking a model to phrase at all.
 *
 * A week outside the four-week programme, or one the plan schedules nothing
 * in, has no coaching conclusion to reword — the deterministic wording already
 * says the true and useful thing. Both sides check the same predicate, so the
 * client never offers a button whose call the backend would decline to spend
 * anything on.
 */
export const isExplainableWeek = (metrics: WeeklyReviewMetrics): boolean =>
  metrics.hasPlan && metrics.weekNumber !== null && metrics.completionPercent !== null;

/* ------------------------------------------------------------------ *
 * The model's side of the contract
 * ------------------------------------------------------------------ */

/**
 * What a model is allowed to return.
 *
 * Strict and bounded: three short German strings and a category that must
 * match the one the rules already chose. There is no field for an exercise, a
 * set count, a schedule or a plan — a shape that cannot express a plan change
 * cannot smuggle one in.
 */
export const weeklyRecommendationResponseSchema = z
  .object({
    category: z.enum(RECOMMENDATION_CATEGORIES),
    headline: z.string().trim().min(3).max(70),
    message: z.string().trim().min(20).max(320),
    reason: z.string().trim().min(10).max(240),
  })
  .strict();

export type WeeklyRecommendationResponse = z.infer<typeof weeklyRecommendationResponseSchema>;

/**
 * Wording a coaching recommendation must never contain.
 *
 * The response schema stops a model returning plan *structure*; these stop it
 * returning claims. The four unsupported-inference rules are the important
 * ones, and they exist because the prompt is not a guarantee: a model handed
 * "3 of 3 completed, twice running" will reach for "you're ready to progress"
 * unless something refuses it.
 *
 * The test that every deterministic variant passes these rules runs in the
 * same suite, so the app's own words are held to the standard it holds a
 * model to.
 */
const UNSAFE_TEXT_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  {
    // No medical, injury or diagnostic claim. There is no data behind one.
    id: "medical",
    pattern:
      /verletz|schmerz|diagnos|krankheit|arzt|ärzt|therapie|rehabilit|medikament|übertraining|übertrainiert/i,
  },
  {
    /*
      No fatigue reading. Nothing in this app records perceived effort, sleep
      or how a session felt, so "you seem tired" is invention whichever way it
      is phrased — including the flattering direction ("you have reserves").
    */
    id: "fatigue",
    pattern:
      /erschöpf|ausgelaugt|übermüdet|müdigkeit|\bmüde\b|überlast|überforder|zu viel trainiert|reserven|belastung|beanspruch|anstrengend/i,
  },
  {
    /*
      No recovery claim. A completion tally cannot say whether somebody has
      recovered, needs a deload, or is regenerating well — nor whether they
      should rest. "Ruhetag" is deliberately not here: naming the plan's own
      rest days is a statement about the plan, and the dense-schedule wording
      needs it.
    */
    id: "recovery-claim",
    pattern:
      /regeneration|regeneriert|erholung|erholt|deload|entlastungswoche|ausgeruht|pausier|\bpause\b|ruhephase|schone dich|gönn/i,
  },
  {
    /*
      No readiness verdict in either direction. Adherence is not evidence that
      a person should train more, and "your body is ready" is a claim about a
      body this app has never measured.

      `\bbereit\b` is the broad one and is meant to be: after two full weeks a
      model reaches for "du bist bereit" in a dozen phrasings, and there is no
      sentence this feature needs to say that contains the word. The boundary
      keeps "bereits" — a perfectly ordinary word here — out of it.
    */
    id: "progress-readiness",
    pattern:
      /\bbereit\b|kannst du (jetzt|nun|ab jetzt) (mehr|steiger|erhöh)|zeit für (mehr|die nächste)|nächste stufe|dein(em|es|en)? körper|du verträgst|belastbarkeit|du schaffst mehr|noch mehr drin/i,
  },
  {
    /*
      No workload prescription. Suggesting more or fewer sessions, sets or
      volume is a verdict on a plan the app cannot evaluate — the reader is
      given a question about their schedule instead, never an instruction.

      The stems are matched rather than exact forms: "steigere", "steigern" and
      "Steigerung" are the same claim, and a guard that only caught the
      imperative would be a guard a model walks around by using the infinitive.
    */
    id: "workload-prescription",
    pattern:
      /reduzier|verringer|pensum|steiger|erhöh|mehr volumen|volumen (erhöh|reduzier)|trainiere (mehr|öfter|häufiger|weniger|intensiver)|(mehr|öfter|häufiger|weniger|intensiver) (zu )?trainieren|(weniger|mehr) einheiten|mehr gewicht|schwerer|intensiver/i,
  },
  {
    // Nutrition is a separate product surface and is not advised from here.
    id: "nutrition",
    pattern: /kalorien|makros|eiweiss|eiweiß|protein|ernährung|supplement|nahrungsergänz/i,
  },
  {
    // Nothing may suggest the plan was already changed, or will change itself.
    id: "plan-mutation",
    pattern:
      /automatisch|angepasst|angepasste|aktualisiert|umgestellt|neu erstellt|überschrieben|für dich geändert/i,
  },
  {
    // No prescribed plan content: sets, reps, loads or "3x10".
    id: "plan-content",
    pattern: /\d+\s*(sätze|satz\b|wiederholung|wdh)|\d+\s*[x×]\s*\d+|\d+\s*kg\b/i,
  },
];

/**
 * Rule ids the given wording violates. Empty means it is safe to show.
 *
 * Returns the ids rather than throwing so the caller can log *which* rule
 * failed without logging the text that failed it. Takes a partial shape on
 * purpose: it is run over untrusted values — a model's output on the server, a
 * response body in the browser — before anything has confirmed they are whole.
 */
export const findUnsafeRecommendationText = (value: {
  headline?: unknown;
  message?: unknown;
  reason?: unknown;
}): string[] => {
  const combined = [value.headline, value.message, value.reason]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return UNSAFE_TEXT_RULES.filter((rule) => rule.pattern.test(combined)).map((rule) => rule.id);
};

export type RecommendationRejection =
  | "schema"
  | "category-mismatch"
  | "unsafe-text";

/**
 * Validate a model's recommendation against the deterministic one.
 *
 * Three gates, in order: the shape, the category, and the wording. The
 * category gate is what keeps the decision deterministic — a model that
 * disagrees with the rules is rejected, not obeyed, so it can only ever
 * rephrase a conclusion the numbers already support.
 */
export const validateModelRecommendation = (
  output: unknown,
  expected: RecommendationCategory
):
  | { ok: true; recommendation: WeeklyRecommendation }
  | { ok: false; rejection: RecommendationRejection } => {
  const parsed = weeklyRecommendationResponseSchema.safeParse(output);
  if (!parsed.success) return { ok: false, rejection: "schema" };
  if (parsed.data.category !== expected) return { ok: false, rejection: "category-mismatch" };

  const unsafe = findUnsafeRecommendationText(parsed.data);
  if (unsafe.length > 0) return { ok: false, rejection: "unsafe-text" };

  return {
    ok: true,
    recommendation: {
      category: parsed.data.category,
      headline: parsed.data.headline.trim(),
      message: parsed.data.message.trim(),
      reason: parsed.data.reason.trim(),
      source: "ai",
    },
  };
};
