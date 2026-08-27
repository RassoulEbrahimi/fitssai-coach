import { DAYS_PER_WEEK, PLAN_TOTAL_WEEKS, PLAN_WEEK_KEYS } from "../../../shared/workoutPlan";
import type { PlanGenerationInput } from "./planGenerationInput";

/**
 * The instruction given to the model.
 *
 * Built from the five minimised inputs and nothing else. It states the plan
 * contract the shared schema will enforce anyway — a model told the rules
 * fails validation less often, which matters when a failure costs a second
 * paid call — and it draws the lines the product does not cross: no medical or
 * injury advice, no nutrition, no supplements, no adaptation to a history the
 * model was not given and does not have.
 */

const GERMAN_DAY_NAMES = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

/** German labels for the stable equipment ids, so the model reads them. */
const EQUIPMENT_LABELS: Readonly<Record<string, string>> = {
  full_gym: "voll ausgestattetes Fitnessstudio",
  bodyweight: "Körpergewicht",
  dumbbells: "Kurzhanteln",
  barbell: "Langhantel",
  machines: "Trainingsmaschinen",
  cable_machine: "Kabelzug",
  resistance_bands: "Widerstandsbänder",
  kettlebell: "Kettlebell",
  pullup_bar: "Klimmzugstange",
};

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

export const SYSTEM_INSTRUCTION = [
  "Du bist ein Trainingsplaner. Du erzeugst ausschließlich strukturierte Daten,",
  "die von einer Software weiterverarbeitet werden — kein Fließtext, keine",
  "Begrüßung, keine Erklärung außerhalb der Datenstruktur.",
  "",
  "Feste Regeln:",
  `- Der Plan hat exakt ${PLAN_TOTAL_WEEKS} Wochen: ${PLAN_WEEK_KEYS.join(", ")}.`,
  `- Jede Woche hat exakt ${DAYS_PER_WEEK} Tage in dieser Reihenfolge: ${GERMAN_DAY_NAMES.join(", ")}.`,
  "- Ein Ruhetag ist ein Tag mit einer leeren Übungsliste.",
  "- Übungsnamen und Beschreibungen sind auf Deutsch.",
  "- 'sets' ist eine ganze Zahl größer als 0.",
  "- 'reps' ist eine Zeichenkette, z. B. \"8-12\" oder \"10\".",
  "- Verwende ausschließlich Übungen, die mit der verfügbaren Ausrüstung möglich sind.",
  "",
  "Das darfst du nicht:",
  "- keine medizinischen Aussagen, keine Diagnosen, keine Verletzungs- oder",
  "  Rehabilitationsempfehlungen;",
  "- keine Ernährungsempfehlungen und keine Nahrungsergänzungsmittel;",
  "- keine leistungssteigernden Substanzen;",
  "- keine Aussagen über den bisherigen Trainingsverlauf der Person — du kennst",
  "  ihn nicht;",
  "- keine Ansprache, die beschämt oder Druck aufbaut.",
].join("\n");

/** The per-request instruction. Contains only the five minimised inputs. */
export const buildPlanPrompt = (input: PlanGenerationInput): string => {
  const equipment = input.equipment
    .map((id) => EQUIPMENT_LABELS[id] ?? id)
    .join(", ");

  const restDays = DAYS_PER_WEEK - input.daysPerWeek;

  return [
    "Erstelle einen Trainingsplan mit diesen Vorgaben:",
    "",
    `- Ziel: ${GOAL_LABELS[input.goal] ?? input.goal}`,
    input.experienceLevel
      ? `- Erfahrungslevel: ${EXPERIENCE_LABELS[input.experienceLevel] ?? input.experienceLevel}`
      : null,
    `- Verfügbare Ausrüstung: ${equipment}`,
    `- Trainingstage pro Woche: ${input.daysPerWeek}`,
    `- Zieldauer pro Einheit: ca. ${input.sessionMinutes} Minuten`,
    "",
    `In jeder Woche sind genau ${input.daysPerWeek} Tage Trainingstage und genau`,
    `${restDays} Tage Ruhetage (leere Übungsliste). Verteile die Trainingstage`,
    "sinnvoll über die Woche.",
    "",
    "Wähle Umfang und Übungsanzahl so, dass eine Einheit realistisch in die",
    "Zieldauer passt. Das Erfahrungslevel bestimmt die Komplexität der Übungen,",
    "das Ziel die Auswahl und Priorisierung.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};
