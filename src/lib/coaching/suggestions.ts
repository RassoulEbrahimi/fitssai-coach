import type { FitnessGoal } from "./fitnessGoal";
import type { ProgressionFact, WeeklyCoachingFacts } from "./facts";

/**
 * Deterministic coaching suggestions.
 *
 * Rules over facts, in priority order. Each returns a structured code plus the
 * numbers behind it; German copy lives in the presenter, so the rules stay
 * testable without asserting on prose.
 *
 * Out of scope by design, and enforced by review rather than by code: no
 * overtraining or fatigue diagnosis, no injury inference, no rehabilitation
 * advice, no medical claim, no shame, and nothing that mutates a plan. The
 * engine takes readonly facts and returns new objects.
 */

export type SuggestionCode =
  | "adherence-high"
  | "adherence-low"
  | "adherence-partial"
  | "progression-weight"
  | "progression-reps"
  | "progression-sets"
  | "volume-reduced"
  | "frequency-mismatch"
  | "session-length-mismatch"
  | "plan-finished"
  | "no-data";

export interface CoachingSuggestion {
  code: SuggestionCode;
  /** Higher wins. Ordering only — never changes a number. */
  priority: number;
  /** Facts the presenter interpolates. Never free text. */
  params?: Record<string, string | number>;
}

const ADHERENCE_HIGH = 80;
const ADHERENCE_LOW = 40;

/**
 * Goal nudges *ordering* only.
 *
 * The metrics are identical whatever the goal is; this just decides which
 * true statement leads. An absent goal simply adds nothing.
 */
const goalBoost = (code: SuggestionCode, goal: FitnessGoal | undefined): number => {
  if (!goal) return 0;
  if (goal === "gainMuscle" && code.startsWith("progression-")) return 15;
  if (goal === "improveCardio" && (code === "session-length-mismatch" || code.startsWith("adherence-"))) return 15;
  if (goal === "maintain" && code.startsWith("adherence-")) return 10;
  // loseFat deliberately gets no boost: prioritising it would invite calorie or
  // weight-loss prescriptions, which this PR does not make.
  return 0;
};

const progressionCode = (kind: ProgressionFact["kind"]): SuggestionCode => {
  switch (kind) {
    case "weight-increase": return "progression-weight";
    case "reps-increase": return "progression-reps";
    case "sets-increase": return "progression-sets";
    case "reduced-volume": return "volume-reduced";
  }
};

/**
 * Every suggestion the facts support, most important first.
 *
 * The caller usually shows the first one; the whole list exists so tests can
 * assert on priority rather than on which single item won.
 */
export const buildSuggestions = (facts: WeeklyCoachingFacts): CoachingSuggestion[] => {
  const suggestions: CoachingSuggestion[] = [];

  if (!facts.hasAnyData) {
    return [{ code: "no-data", priority: 100 }];
  }

  // A finished programme is the most actionable thing there is.
  if (facts.planFinished) {
    suggestions.push({ code: "plan-finished", priority: 90 });
  }

  const { adherencePercent, completedDays, scheduledDays } = facts.adherence;
  if (adherencePercent !== null) {
    const params = { completed: completedDays, scheduled: scheduledDays, percent: adherencePercent };
    if (adherencePercent >= ADHERENCE_HIGH) {
      suggestions.push({ code: "adherence-high", priority: 60, params });
    } else if (adherencePercent <= ADHERENCE_LOW) {
      // Consistency before volume. Not a reprimand, and never a diagnosis.
      suggestions.push({ code: "adherence-low", priority: 80, params });
    } else {
      suggestions.push({ code: "adherence-partial", priority: 55, params });
    }
  }

  facts.progression.forEach((fact) => {
    const code = progressionCode(fact.kind);
    suggestions.push({
      code,
      priority: code === "volume-reduced" ? 50 : 70,
      params: { exercise: fact.exerciseName, previous: fact.previous, current: fact.current },
    });
  });

  if (facts.alignment.frequency && !facts.alignment.frequency.matches) {
    suggestions.push({
      code: "frequency-mismatch",
      priority: 45,
      params: {
        preferred: facts.alignment.frequency.preferred,
        scheduled: facts.alignment.frequency.scheduled,
      },
    });
  }

  if (facts.alignment.sessionLength && !facts.alignment.sessionLength.matches) {
    suggestions.push({
      code: "session-length-mismatch",
      priority: 40,
      params: {
        preferred: facts.alignment.sessionLength.preferredMinutes,
        measured: facts.alignment.sessionLength.measuredAverageMinutes,
        coverage: facts.alignment.sessionLength.coverage,
      },
    });
  }

  return suggestions
    .map((suggestion) => ({
      ...suggestion,
      priority: suggestion.priority + goalBoost(suggestion.code, facts.goal),
    }))
    .sort((a, b) => b.priority - a.priority);
};

/** The single suggestion to lead with, or null when the facts support none. */
export const primarySuggestion = (facts: WeeklyCoachingFacts): CoachingSuggestion | null =>
  buildSuggestions(facts)[0] ?? null;
