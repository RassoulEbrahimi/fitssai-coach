import type { AiErrorCode, RequiredProfileField } from "./planGeneration";

/**
 * German copy for every failure the backend can report.
 *
 * The mapping is exhaustive by type, so a new error code cannot ship without
 * someone deciding what the user is told. Nothing here quotes the provider or
 * the backend: what a user reads is written here, in advance, by a person.
 */

/** The user's own words for the profile answers a plan needs. */
export const PROFILE_FIELD_LABELS: Readonly<Record<RequiredProfileField, string>> = {
  fitnessGoal: "Trainingsziel",
  experienceLevel: "Erfahrungslevel",
  equipment: "Ausrüstung",
  daysPerWeek: "Trainingstage pro Woche",
  sessionMinutes: "Trainingsdauer",
};

export interface PlanGenerationMessage {
  title: string;
  description: string;
}

export const planGenerationErrorMessage = (
  code: AiErrorCode,
  context: { missingFields?: RequiredProfileField[]; limit?: number } = {}
): PlanGenerationMessage => {
  switch (code) {
    case "PROFILE_INCOMPLETE": {
      const fields = (context.missingFields ?? []).map((field) => PROFILE_FIELD_LABELS[field]);
      return {
        title: "Vervollständige zuerst deine Trainingseinstellungen.",
        description:
          fields.length > 0
            ? `Es fehlt noch: ${fields.join(", ")}.`
            : "In deinem Profil fehlen noch Angaben.",
      };
    }

    case "QUOTA_EXCEEDED":
      return {
        title: "Monatslimit erreicht",
        description: `Du kannst ${context.limit ?? 3} Pläne pro Monat erstellen. Nächsten Monat geht es weiter.`,
      };

    case "REQUEST_IN_PROGRESS":
      return {
        title: "Wird bereits erstellt",
        description: "Dein Plan wird gerade erstellt. Einen Moment noch.",
      };

    case "PROVIDER_RATE_LIMITED":
      return {
        title: "Gerade zu viele Anfragen",
        description: "Versuche es in ein paar Minuten noch einmal.",
      };

    case "PROVIDER_UNAVAILABLE":
      return {
        title: "Erstellung gerade nicht möglich",
        description: "Der Dienst ist vorübergehend nicht erreichbar. Versuche es später erneut.",
      };

    case "MODEL_OUTPUT_INVALID":
      return {
        title: "Plan konnte nicht erstellt werden",
        description: "Es kam kein gültiger Plan zustande. Versuche es bitte noch einmal.",
      };

    case "PERSISTENCE_FAILED":
      return {
        title: "Plan konnte nicht gespeichert werden",
        description: "Der Plan wurde erstellt, aber nicht gespeichert. Versuche es noch einmal.",
      };

    case "UNAUTHENTICATED":
      return {
        title: "Nicht angemeldet",
        description: "Melde dich an, um einen Plan zu erstellen.",
      };

    case "INVALID_REQUEST":
    case "INTERNAL":
      return {
        title: "Etwas ist schiefgelaufen",
        description: "Versuche es bitte noch einmal.",
      };
  }
};
