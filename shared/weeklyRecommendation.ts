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
  measuredSessionCount: number;
  unmeasuredSessionCount: number;
  durationCoverage: DurationCoverageState;
  /** The week before, when the plan has one. Drives "reduce" and "increase". */
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
): { scheduledDays: number; completedDays: number; completionPercent: number | null } => {
  const done = new Set(
    completions
      .filter((entry) => entry.completed && entry.weekKey === weekKey)
      .map((entry) => entry.dayIndex)
  );

  const trainingDays = planDays.filter((day) => day.exerciseCount > 0);
  const scheduledDays = trainingDays.length;
  const completedDays = trainingDays.filter((day) => done.has(day.dayIndex)).length;

  return {
    scheduledDays,
    completedDays,
    completionPercent:
      scheduledDays === 0 ? null : clampPercent((completedDays / scheduledDays) * 100),
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

  let measuredDurationSec = 0;
  let measuredSessionCount = 0;
  let unmeasuredSessionCount = 0;

  input.weekLogs.forEach((log) => {
    const seconds = usableDurationSec(log.durationSec);
    if (seconds === null) {
      unmeasuredSessionCount += 1;
      return;
    }
    measuredDurationSec += seconds;
    measuredSessionCount += 1;
  });

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

export const RECOMMENDATION_CATEGORIES = [
  /** Keep the current plan and the current workload. */
  "maintain",
  /** Regularity before volume. */
  "consistency",
  /** A smaller weekly workload would likely be more realistic. */
  "reduce",
  /** A cautious increase is defensible. */
  "increase",
  /** Plan a rest day. Never a physiological or medical claim. */
  "recovery",
] as const;

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

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
 * Which category the week falls into.
 *
 * Conservative by construction, and by design it is the *only* place the
 * decision is made — a model is told the answer, never asked for it.
 *
 * Note what is deliberately absent: no fatigue, no overtraining, no readiness,
 * no injury risk. A count of ticked-off sessions cannot support any of them,
 * and this app has no other signal. `recovery` is reached only on a fact about
 * the *plan* — a week that schedules all seven days — never on an inference
 * about the person.
 */
export const recommendCategory = (metrics: WeeklyReviewMetrics): RecommendationCategory => {
  if (!metrics.hasPlan || metrics.scheduledDays === 0) return "consistency";

  const percent = metrics.completionPercent ?? 0;
  const previous = metrics.previousWeek?.completionPercent ?? null;

  if (percent >= 100) {
    // Seven scheduled training days means the plan left no rest day at all.
    if (metrics.scheduledDays >= 7) return "recovery";
    // One full week is not a trend; two in a row is the earliest point at
    // which suggesting more is defensible.
    if (previous !== null && previous >= 100) return "increase";
    return "maintain";
  }

  if (metrics.completedDays === 0) return "consistency";

  if (percent < LOW_COMPLETION_PERCENT) {
    // A second low week in a row on a demanding schedule: the plan asking for
    // less is a more useful suggestion than "try harder".
    if (previous !== null && previous < LOW_COMPLETION_PERCENT && metrics.scheduledDays >= 4) {
      return "reduce";
    }
    return "consistency";
  }

  return "maintain";
};

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
  return metrics.durationCoverage === "partial"
    ? ` Erfasste Trainingszeit: mindestens ${total} aus ${metrics.measuredSessionCount} erfassten Einheiten.`
    : ` Erfasste Trainingszeit: ${total}.`;
};

const completionClause = (metrics: WeeklyReviewMetrics): string =>
  metrics.completionPercent === null
    ? "Für diese Woche sind keine Trainingstage geplant."
    : `${metrics.completedDays} von ${metrics.scheduledDays} Trainingstagen abgeschlossen (${metrics.completionPercent} %).`;

/**
 * The deterministic wording for a category.
 *
 * Written to be true whatever else is on screen, and to never imply that
 * anything was changed for the user: every variant says the plan stays as it
 * is, because it does. The user decides what happens next.
 */
export const describeRecommendation = (metrics: WeeklyReviewMetrics): WeeklyRecommendation => {
  const category = recommendCategory(metrics);
  const reason = `Grundlage: ${completionClause(metrics)}${durationClause(metrics)}`;

  switch (category) {
    case "consistency": {
      if (!metrics.hasPlan || metrics.scheduledDays === 0) {
        return {
          category,
          headline: "Noch nichts geplant",
          message:
            "Für diese Woche sind keine Trainingstage hinterlegt. Sobald ein Plan aktiv ist, siehst du hier deinen Wochenfortschritt.",
          reason,
          source: "deterministic",
        };
      }
      if (metrics.completedDays === 0) {
        return {
          category,
          headline: "Fang klein an",
          message:
            `Diese Woche ist noch keine deiner ${metrics.scheduledDays} geplanten Einheiten abgeschlossen. ` +
            "Eine einzelne Einheit ist ein guter nächster Schritt. Dein Plan bleibt dabei genau so, wie er ist.",
          reason,
          source: "deterministic",
        };
      }
      return {
        category,
        headline: "Regelmäßigkeit zuerst",
        message:
          `Du hast ${metrics.completedDays} von ${metrics.scheduledDays} Einheiten abgeschlossen. ` +
          "Hol die offenen Einheiten nach, bevor du den Umfang erhöhst. Dein Plan bleibt unverändert.",
        reason,
        source: "deterministic",
      };
    }

    case "reduce":
      return {
        category,
        headline: "Weniger einplanen ist auch ein Fortschritt",
        message:
          "In dieser und der vorigen Woche ist jeweils der größere Teil der Einheiten offen geblieben. " +
          "Ein kleinerer Wochenumfang wäre womöglich realistischer. Ob du das umsetzt, entscheidest du.",
        reason,
        source: "deterministic",
      };

    case "increase":
      return {
        category,
        headline: "Zwei vollständige Wochen",
        message:
          "Du hast diese und die vorige Woche vollständig abgeschlossen. Eine vorsichtige Steigerung wäre " +
          "ab jetzt vertretbar. Der nächste Schritt liegt bei dir.",
        reason,
        source: "deterministic",
      };

    case "recovery":
      return {
        category,
        headline: "Ein Ruhetag wäre eine Überlegung wert",
        message:
          "Dein Plan sieht diese Woche an allen sieben Tagen eine Einheit vor, und du hast sie alle abgeschlossen. " +
          "Für die kommende Woche wäre ein fester Ruhetag eine Überlegung wert.",
        reason,
        source: "deterministic",
      };

    case "maintain":
      return metrics.completionPercent !== null && metrics.completionPercent >= 100
        ? {
            category,
            headline: "Woche vollständig abgeschlossen",
            message:
              `Alle ${metrics.scheduledDays} geplanten Einheiten sind erledigt. Halte diesen Umfang zunächst bei — ` +
              "eine volle Woche ist ein guter Grund, nichts zu ändern.",
            reason,
            source: "deterministic",
          }
        : {
            category,
            headline: "Du bist auf Kurs",
            message:
              `${metrics.completedDays} von ${metrics.scheduledDays} Einheiten sind abgeschlossen. ` +
              "Bleib beim aktuellen Umfang und schließe die offenen Einheiten ab.",
            reason,
            source: "deterministic",
          };
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
 * The schema stops the model returning plan *structure*; this stops it
 * returning plan structure as prose, plus the three things the product does
 * not say at all. Checked on the way out of the backend, so a model that
 * ignores its instructions is refused rather than rendered.
 */
const UNSAFE_TEXT_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  {
    // No medical, injury or diagnostic claim. There is no data behind one.
    id: "medical",
    pattern:
      /verletz|schmerz|diagnos|krankheit|arzt|ärzt|therapie|rehabilit|medikament|übertraining|überlastung|regenerationsfähigkeit/i,
  },
  {
    // Nutrition is a separate product surface and is not advised from here.
    id: "nutrition",
    pattern: /kalorien|makros|eiweiss|eiweiß|protein|ernährung|supplement|nahrungsergänz/i,
  },
  {
    // Nothing may suggest the plan was already changed, or will change itself.
    id: "plan-mutation",
    pattern: /automatisch|angepasst|angepasste|aktualisiert|umgestellt|neu erstellt|überschrieben|für dich geändert/i,
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
