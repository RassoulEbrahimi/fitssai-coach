import type { RecommendationFocus } from "../../../shared/weeklyRecommendation";
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
 *
 * That last one is the subtle rule and it is stated twice. The input is a
 * count of completed sessions — adherence, nothing else. Nothing here records
 * effort, fatigue, recovery, sleep or why a session was missed, so "you are
 * ready to progress" and "that was too much for you" are both invention, and
 * both are the invention a model reaches for unprompted when it sees three of
 * three twice running. The instruction refuses them; a text screen on the way
 * out refuses them again, because an instruction is not a guarantee.
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

/**
 * What each wording angle is, so the model writes the right variant.
 *
 * These are instructions about *tone and content*, never about what to
 * conclude — the conclusion arrived with the input. The two delicate ones,
 * `week-complete-repeat` and `schedule-fit`, spell out what must not be said,
 * because they are the two the data most tempts a reader to over-read.
 */
const FOCUS_BRIEF: Readonly<Record<RecommendationFocus, string>> = {
  "no-plan":
    "Für diese Woche ist nichts geplant. Sachlich feststellen, freundlich bleiben, nichts hineindeuten.",
  "first-session":
    "Noch keine Einheit abgeschlossen. Zu einer ersten Einheit ermutigen, ohne Druck und ohne Vermutung, woran es lag.",
  "catch-up":
    "Ein Teil der Einheiten ist offen. Regelmäßigkeit als nächsten Schritt nennen, ohne den Umfang zu bewerten.",
  "schedule-fit":
    "Zwei Wochen mit wenigen abgeschlossenen Einheiten. Als Frage formulieren, ob die geplanten Tage zum Alltag der Person passen. " +
    "Nicht behaupten, das Training sei zu viel gewesen, und keine Reduzierung empfehlen — warum Einheiten offen blieben, ist unbekannt.",
  "on-track":
    "Der größere Teil der Woche ist geschafft. Bestätigen und beim aktuellen Umfang bleiben.",
  "week-complete":
    "Die Woche ist vollständig abgeschlossen. Anerkennen und den Umfang zunächst beibehalten.",
  "week-complete-repeat":
    "Zwei vollständige Wochen in Folge. Das ist eine Aussage über die Regelmäßigkeit, nicht über Belastbarkeit. " +
    "Eine Veränderung des Umfangs darf höchstens als eigene Entscheidung der Person vorkommen, ausdrücklich abhängig davon, " +
    "wie sich das Training für sie anfühlt — und mit dem Hinweis, dass die App das nicht kennt. Nicht behaupten, die Person sei bereit für mehr.",
  "dense-schedule":
    "Der Plan sieht an allen sieben Tagen eine Einheit vor und alle wurden abgeschlossen. " +
    "Das als Eigenschaft des Plans benennen. Ob ein Ruhetag passt, entscheidet die Person; keine Aussage über Erholung oder Belastung treffen.",
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
  "- Die Eingabe enthält ausschließlich Zählwerte zu abgeschlossenen und",
  "  geplanten Einheiten. Wie anstrengend das Training war, wie erholt oder",
  "  müde die Person ist und warum Einheiten offen blieben, ist unbekannt.",
  "- 'headline' ist eine kurze Überschrift, 'message' die Empfehlung in ein bis",
  "  zwei Sätzen, 'reason' die Begründung aus den gelieferten Zahlen.",
  "",
  "Das darfst du nicht:",
  "- keine Übungen, Sätze, Wiederholungen, Gewichte oder Trainingspläne nennen;",
  "- nicht behaupten, der Plan sei geändert, angepasst oder neu erstellt worden —",
  "  am Plan der Person ändert sich durch diese Rückmeldung nichts;",
  "- keine medizinischen Aussagen, keine Diagnosen, keine Aussagen über",
  "  Verletzungen, Schmerzen, Erschöpfung oder Regeneration des Körpers;",
  "- nicht behaupten, die Person sei bereit für mehr Umfang, brauche eine",
  "  Entlastung oder habe zu viel oder zu wenig trainiert — dafür liegen keine",
  "  Daten vor;",
  "- keine Empfehlung, mehr oder weniger zu trainieren, und keine Angabe zu",
  "  Sätzen, Wiederholungen, Gewichten oder Übungen;",
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
    `- Schwerpunkt: ${input.focus}`,
    `  ${FOCUS_BRIEF[input.focus]}`,
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
};
