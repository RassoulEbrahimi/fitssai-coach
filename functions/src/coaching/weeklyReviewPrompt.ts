import { RECOMMENDATION_CATEGORIES } from "../../../shared/weeklyRecommendation";
import type { WeeklyReviewInput } from "./weeklyReviewInput";

/**
 * The instruction for the weekly coaching recommendation.
 *
 * The model's whole job is wording. It receives numbers the backend already
 * computed and a category the backend already chose, and it returns three
 * short German strings. It is told, in the instruction and again by a schema
 * that has no field for it, that it may not invent a metric, may not change
 * the category, and may not prescribe plan content.
 *
 * The prohibitions are the product rules, stated where the model can read
 * them: this feature advises, it never changes a plan, and it makes no claim
 * about a person's body that the app has no data for.
 */

const GOAL_LABELS: Readonly<Record<string, string>> = {
  gainMuscle: "Muskeln aufbauen",
  loseFat: "Fett verlieren",
  improveCardio: "Kardio verbessern",
  maintain: "Fitness halten",
};

const EXPERIENCE_LABELS: Readonly<Record<string, string>> = {
  beginner: "Anfänger",
  intermediate: "Fortgeschritten",
  advanced: "Erfahren",
};

/** What each category means, so the wording matches the conclusion. */
const CATEGORY_MEANING: Readonly<Record<(typeof RECOMMENDATION_CATEGORIES)[number], string>> = {
  maintain: "Der aktuelle Umfang passt. Nichts am Plan ändern.",
  consistency: "Regelmäßigkeit geht vor Umfang. Offene Einheiten nachholen.",
  reduce: "Ein kleinerer Wochenumfang wäre realistischer — als Überlegung, nicht als Anweisung.",
  increase: "Eine vorsichtige Steigerung wäre vertretbar — als Überlegung, nicht als Anweisung.",
  recovery: "Ein fester Ruhetag in der kommenden Woche wäre eine Überlegung wert.",
};

export const WEEKLY_REVIEW_SYSTEM_INSTRUCTION = [
  "Du formulierst eine kurze, sachliche Rückmeldung zur Trainingswoche einer Person.",
  "Du antwortest ausschließlich mit der vorgegebenen JSON-Struktur, auf Deutsch,",
  "in der Du-Form.",
  "",
  "Feste Regeln:",
  "- Die Zahlen in der Eingabe sind bereits berechnet. Übernimm sie unverändert",
  "  oder lass sie weg. Erfinde keine weiteren Zahlen und rechne nichts um.",
  "- Die Kategorie in der Eingabe steht fest. Formuliere genau diese Kategorie",
  "  und gib sie unverändert zurück.",
  "- 'headline' ist eine kurze Überschrift, 'message' die Empfehlung in ein bis",
  "  zwei Sätzen, 'reason' die Begründung aus den gelieferten Zahlen.",
  "",
  "Das darfst du nicht:",
  "- keine Übungen, Sätze, Wiederholungen, Gewichte oder Trainingspläne nennen;",
  "- nicht behaupten, der Plan sei geändert, angepasst oder neu erstellt worden —",
  "  am Plan der Person ändert sich durch diese Rückmeldung nichts;",
  "- keine medizinischen Aussagen, keine Diagnosen, keine Aussagen über",
  "  Verletzungen, Schmerzen, Erschöpfung oder Regeneration des Körpers;",
  "- keine Ernährungs- oder Nahrungsergänzungsempfehlungen;",
  "- keine Aussagen über Daten, die dir nicht vorliegen;",
  "- keine Ansprache, die beschämt, druckvoll wirkt oder Schuld zuweist.",
].join("\n");

/** The per-request instruction. Contains only the minimised input. */
export const buildWeeklyReviewPrompt = (input: WeeklyReviewInput): string => {
  const lines: Array<string | null> = [
    "Formuliere die Rückmeldung zu dieser Trainingswoche:",
    "",
    `- Woche im Plan: ${input.weekNumber} von 4`,
    `- Geplante Trainingstage: ${input.scheduledDays}`,
    `- Abgeschlossene Trainingstage: ${input.completedDays}`,
    `- Offene Trainingstage: ${input.missedDays}`,
    `- Abschlussquote: ${input.completionPercent} %`,
    input.measuredDurationMinutes !== undefined
      ? `- Erfasste Trainingszeit: ${input.measuredDurationMinutes} Minuten aus ${input.measuredSessionCount ?? 0} erfassten Einheiten`
      : "- Erfasste Trainingszeit: liegt nicht vor (nicht erwähnen)",
    input.previousWeekCompletionPercent !== undefined
      ? `- Abschlussquote der Vorwoche: ${input.previousWeekCompletionPercent} %`
      : null,
    input.goal ? `- Ziel der Person: ${GOAL_LABELS[input.goal] ?? input.goal}` : null,
    input.experienceLevel
      ? `- Erfahrungslevel: ${EXPERIENCE_LABELS[input.experienceLevel] ?? input.experienceLevel}`
      : null,
    "",
    `- Kategorie (unveränderlich): ${input.category}`,
    `  Bedeutung: ${CATEGORY_MEANING[input.category]}`,
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
};
