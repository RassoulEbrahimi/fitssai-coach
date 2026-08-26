import { z } from "zod";

/**
 * The training preferences a coach needs before it can propose anything.
 *
 * This is the single definition of the equipment taxonomy and the two numeric
 * preferences. Onboarding, profile editing and any later coaching code read
 * from here so the option lists cannot drift apart.
 *
 * Everything is optional on read. Profiles created before these questions
 * existed simply do not carry them, and nothing infers a value for those
 * users — an absent preference stays absent rather than becoming a default
 * that looks like an answer.
 */

export const EQUIPMENT_TYPES = [
  "full_gym",
  "bodyweight",
  "dumbbells",
  "barbell",
  "machines",
  "cable_machine",
  "resistance_bands",
  "kettlebell",
  "pullup_bar",
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export interface EquipmentOption {
  id: EquipmentType;
  label: string;
  /** Shown under the label where the choice needs explaining. */
  hint?: string;
}

/** Stable ids, German labels. Order is the order the user sees. */
export const EQUIPMENT_OPTIONS: readonly EquipmentOption[] = [
  {
    id: "full_gym",
    label: "Voll ausgestattetes Fitnessstudio",
    hint: "Deckt alles ab — Einzelnes musst du dann nicht auswählen.",
  },
  { id: "bodyweight", label: "Körpergewicht" },
  { id: "dumbbells", label: "Kurzhanteln" },
  { id: "barbell", label: "Langhantel" },
  { id: "machines", label: "Trainingsmaschinen" },
  { id: "cable_machine", label: "Kabelzug" },
  { id: "resistance_bands", label: "Widerstandsbänder" },
  { id: "kettlebell", label: "Kettlebell" },
  { id: "pullup_bar", label: "Klimmzugstange" },
] as const;

const EQUIPMENT_LABELS = new Map<EquipmentType, string>(
  EQUIPMENT_OPTIONS.map((option) => [option.id, option.label])
);

export const isEquipmentType = (value: unknown): value is EquipmentType =>
  typeof value === "string" && (EQUIPMENT_TYPES as readonly string[]).includes(value);

export const equipmentLabel = (id: EquipmentType): string =>
  EQUIPMENT_LABELS.get(id) ?? id;

/** Bounds are product limits, not storage limits — see the manifest. */
export const DAYS_PER_WEEK_MIN = 1;
export const DAYS_PER_WEEK_MAX = 7;
export const SESSION_MINUTES_MIN = 15;
export const SESSION_MINUTES_MAX = 180;

/** What a *new* submission must satisfy. At least one piece of equipment. */
export const equipmentSchema = z
  .array(z.enum(EQUIPMENT_TYPES))
  .min(1, "Wähle mindestens eine Option")
  .max(EQUIPMENT_TYPES.length);

export const daysPerWeekSchema = z
  .number({ invalid_type_error: "Bitte auswählen" })
  .int()
  .min(DAYS_PER_WEEK_MIN)
  .max(DAYS_PER_WEEK_MAX);

export const sessionMinutesSchema = z
  .number({ invalid_type_error: "Bitte auswählen" })
  .int()
  .min(SESSION_MINUTES_MIN)
  .max(SESSION_MINUTES_MAX);

export interface CoachingPreferences {
  equipment?: EquipmentType[];
  /** Preferred training days per week, 1–7. */
  daysPerWeek?: number;
  /**
   * Preferred length of a normal session in minutes, 15–180.
   *
   * A *preference*, not a measurement. PR47's `durationSec` on a workout log
   * is observed history; these two are never derived from one another.
   */
  sessionMinutes?: number;
}

const readNumber = (value: unknown, schema: z.ZodType<number>): number | undefined => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/**
 * Read preferences out of a raw Firestore document.
 *
 * Tolerant by design: a legacy profile has none of these keys, and a document
 * touched by an older or newer build may carry values this build does not
 * recognise. Unknown equipment ids are dropped rather than rendered, and an
 * out-of-range number is treated as absent — never clamped into range, which
 * would invent an answer the user never gave.
 */
export const parseCoachingPreferences = (
  raw: Record<string, unknown> | null | undefined
): CoachingPreferences => {
  if (!raw) return {};

  const equipment = Array.isArray(raw.equipment)
    ? Array.from(new Set(raw.equipment.filter(isEquipmentType)))
    : undefined;

  return {
    // An array that held only unrecognised ids reads as "nothing usable
    // stored", not as an empty selection the user made.
    equipment: equipment && equipment.length > 0 ? equipment : undefined,
    daysPerWeek: readNumber(raw.daysPerWeek, daysPerWeekSchema),
    sessionMinutes: readNumber(raw.sessionMinutes, sessionMinutesSchema),
  };
};

/** Shown wherever a preference has never been given. */
export const NOT_SPECIFIED = "Nicht angegeben";

export const formatEquipment = (equipment: EquipmentType[] | undefined): string =>
  equipment && equipment.length > 0
    ? equipment.map(equipmentLabel).join(", ")
    : NOT_SPECIFIED;

export const formatDaysPerWeek = (days: number | undefined): string =>
  days === undefined ? NOT_SPECIFIED : `${days} ${days === 1 ? "Tag" : "Tage"} pro Woche`;

export const formatSessionMinutes = (minutes: number | undefined): string =>
  minutes === undefined ? NOT_SPECIFIED : `${minutes} Minuten`;

/** Choices offered in the UI; the schema still bounds what may be stored. */
export const SESSION_MINUTES_CHOICES = [15, 30, 45, 60, 75, 90, 120] as const;
