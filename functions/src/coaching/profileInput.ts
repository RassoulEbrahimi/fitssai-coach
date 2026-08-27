import type { Firestore } from "firebase-admin/firestore";
import { AiError, REQUIRED_PROFILE_FIELDS, type RequiredProfileField } from "../errors";
import {
  EQUIPMENT_TYPES,
  EXPERIENCE_LEVELS,
  planGenerationInputSchema,
  type EquipmentType,
  type ExperienceLevel,
  type FitnessGoal,
  type PlanGenerationInput,
} from "./planGenerationInput";

/**
 * Build the provider input from the caller's own profile document.
 *
 * The server reads the profile rather than accepting one from the client, for
 * two reasons: a client-supplied profile is a client-supplied prompt, and the
 * uid the document is read under comes from the verified token, so a caller
 * cannot generate a plan from somebody else's answers.
 *
 * Only five fields leave this function. Everything else in the document — the
 * name, the email, height, weight, dietary preference, role, the whole
 * workout history — stays where it is. What is never read cannot leak.
 *
 * Nothing is guessed. A missing preference is reported so the user can answer
 * it; inventing "full gym, three days, sixty minutes" would produce a
 * confident plan for a person who never said any of that.
 */

/** Every stored spelling of a goal, mapped to canonical. Mirrors the client. */
const GOAL_ALIASES: Readonly<Record<string, FitnessGoal>> = {
  gainMuscle: "gainMuscle",
  loseFat: "loseFat",
  improveCardio: "improveCardio",
  maintain: "maintain",

  muscle_gain: "gainMuscle",
  weight_loss: "loseFat",
  endurance: "improveCardio",
  maintenance: "maintain",

  "gain-muscle": "gainMuscle",
  "lose-fat": "loseFat",
  "improve-cardio": "improveCardio",
};

export const normaliseFitnessGoal = (value: unknown): FitnessGoal | undefined =>
  typeof value === "string" ? GOAL_ALIASES[value.trim()] : undefined;

const readExperience = (value: unknown): ExperienceLevel | undefined =>
  typeof value === "string" && (EXPERIENCE_LEVELS as readonly string[]).includes(value)
    ? (value as ExperienceLevel)
    : undefined;

const readEquipment = (value: unknown): EquipmentType[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const known = value.filter(
    (entry): entry is EquipmentType =>
      typeof entry === "string" && (EQUIPMENT_TYPES as readonly string[]).includes(entry)
  );
  const unique = [...new Set(known)];
  return unique.length > 0 ? unique : undefined;
};

const readBoundedInt = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;

export interface ProfileReadResult {
  input: PlanGenerationInput;
}

/**
 * Read the caller's profile and reduce it to the generation input.
 *
 * Throws `PROFILE_INCOMPLETE` listing exactly which answers are missing, so
 * the UI can name them rather than saying "something is wrong".
 */
export const buildPlanGenerationInput = async (
  firestore: Firestore,
  uid: string
): Promise<PlanGenerationInput> => {
  const snap = await firestore.collection("users").doc(uid).get();
  const raw = (snap.data() ?? {}) as Record<string, unknown>;

  const candidate = {
    goal: normaliseFitnessGoal(raw.fitnessGoal),
    experienceLevel: readExperience(raw.experienceLevel),
    equipment: readEquipment(raw.equipment),
    daysPerWeek: readBoundedInt(raw.daysPerWeek, 1, 7),
    sessionMinutes: readBoundedInt(raw.sessionMinutes, 15, 180),
  };

  const missing: RequiredProfileField[] = REQUIRED_PROFILE_FIELDS.filter((field) => {
    const key = field === "fitnessGoal" ? "goal" : field;
    return candidate[key as keyof typeof candidate] === undefined;
  });

  if (missing.length > 0) {
    throw new AiError("PROFILE_INCOMPLETE", "Profile is missing generation inputs.", {
      missingFields: missing,
    });
  }

  // Parsed rather than cast: the strict schema is the last word on what may be
  // handed to a provider, even for values this function assembled itself.
  const parsed = planGenerationInputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AiError("PROFILE_INCOMPLETE", "Profile values are out of range.", {
      missingFields: missing,
    });
  }

  return parsed.data;
};
