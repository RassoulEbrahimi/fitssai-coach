import { isNutritionDate, type NutritionDate } from "./dates";

/**
 * Stable Nutrition V2 identities.
 *
 * Every id here is built from structural facts — a calendar date, a slot id, a
 * plan id, a caller-supplied UUID — and from nothing a person reads. Display
 * names change with language and wording, and weekday labels change with the
 * calendar; neither may decide which record something is.
 *
 * All helpers are pure and deterministic: the same inputs always give the same
 * id, and no helper generates randomness. A UUID for an extra entry is created
 * by the caller's environment (e.g. `crypto.randomUUID()`) and passed in, so
 * `shared/` never imports a Node or browser API.
 */

/**
 * The canonical meal slots of a Nutrition V2 day, in day order.
 *
 * Ids, not labels: the UI decides what to call each one, and the two snacks
 * are told apart by position, never by a time of day or a weekday. None
 * contains `:` or `__`, the separators the composite ids below rely on.
 */
export const NUTRITION_SLOT_IDS = ["breakfast", "lunch", "snack_1", "dinner", "snack_2"] as const;

export type NutritionSlotId = (typeof NUTRITION_SLOT_IDS)[number];

export const isNutritionSlotId = (value: unknown): value is NutritionSlotId =>
  typeof value === "string" && (NUTRITION_SLOT_IDS as readonly string[]).includes(value);

/**
 * A Nutrition V2 document or meal id (plan, meal, target version, generation
 * request).
 *
 * Letters, digits and `-` only: that covers Firestore auto-ids and UUIDs, and
 * keeps `__` — the slot-head separator — out of every id that is embedded in
 * another. The length cap keeps composite ids far below Firestore's 1500-byte
 * document-id limit.
 */
export const NUTRITION_DOC_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

export const isNutritionDocId = (value: unknown): value is string =>
  typeof value === "string" && NUTRITION_DOC_ID_PATTERN.test(value);

/** RFC 4122 layout (versions 1–8), any case on input. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const requireDate = (date: unknown): NutritionDate => {
  if (!isNutritionDate(date)) throw new RangeError("date must be a calendar date formatted YYYY-MM-DD");
  return date;
};

const requireSlotId = (slotId: unknown): NutritionSlotId => {
  if (!isNutritionSlotId(slotId)) throw new RangeError(`slotId must be one of ${NUTRITION_SLOT_IDS.join(", ")}`);
  return slotId;
};

const requireDocId = (id: unknown, label: string): string => {
  if (!isNutritionDocId(id)) throw new RangeError(`${label} must match ${NUTRITION_DOC_ID_PATTERN}`);
  return id;
};

/* ------------------------------------------------------------------ *
 * RecordedEntry ids
 * ------------------------------------------------------------------ */

export const SLOT_ENTRY_ID_PREFIX = "slot:";
export const EXTRA_ENTRY_ID_PREFIX = "extra:";

/**
 * `slot:{YYYY-MM-DD}:{slotId}` — the one recorded entry a day's slot can have.
 *
 * Deterministic on purpose: recording the same slot twice addresses the same
 * record instead of creating a second one.
 */
export const slotEntryId = (date: NutritionDate, slotId: NutritionSlotId): string =>
  `${SLOT_ENTRY_ID_PREFIX}${requireDate(date)}:${requireSlotId(slotId)}`;

/**
 * `extra:{uuid}` — a recorded entry outside the day's slots.
 *
 * The UUID is supplied by the caller. It is lower-cased, so one UUID always
 * yields one id.
 */
export const extraEntryId = (uuid: string): string => {
  if (!isUuid(uuid)) throw new RangeError("uuid must be an RFC 4122 UUID");
  return `${EXTRA_ENTRY_ID_PREFIX}${uuid.toLowerCase()}`;
};

export type ParsedEntryId =
  | { kind: "slot"; date: NutritionDate; slotId: NutritionSlotId }
  | { kind: "extra"; uuid: string };

/** The parts of a canonical entry id, or null when it is not one. */
export const parseEntryId = (value: unknown): ParsedEntryId | null => {
  if (typeof value !== "string") return null;

  if (value.startsWith(SLOT_ENTRY_ID_PREFIX)) {
    const parts = value.slice(SLOT_ENTRY_ID_PREFIX.length).split(":");
    if (parts.length !== 2) return null;
    const [date, slotId] = parts;
    return isNutritionDate(date) && isNutritionSlotId(slotId) ? { kind: "slot", date, slotId } : null;
  }

  if (value.startsWith(EXTRA_ENTRY_ID_PREFIX)) {
    const uuid = value.slice(EXTRA_ENTRY_ID_PREFIX.length);
    // Canonical form only: an upper-case id is not one `extraEntryId` produces.
    return isUuid(uuid) && uuid === uuid.toLowerCase() ? { kind: "extra", uuid } : null;
  }

  return null;
};

export const isSlotEntryId = (value: unknown): boolean => parseEntryId(value)?.kind === "slot";

export const isExtraEntryId = (value: unknown): boolean => parseEntryId(value)?.kind === "extra";

/* ------------------------------------------------------------------ *
 * Slot head ids
 * ------------------------------------------------------------------ */

export const SLOT_HEAD_ID_SEPARATOR = "__";

/** `{planId}__{YYYY-MM-DD}__{slotId}` — one head per plan, day and slot. */
export const slotHeadId = (planId: string, date: NutritionDate, slotId: NutritionSlotId): string =>
  [requireDocId(planId, "planId"), requireDate(date), requireSlotId(slotId)].join(SLOT_HEAD_ID_SEPARATOR);

export interface ParsedSlotHeadId {
  planId: string;
  date: NutritionDate;
  slotId: NutritionSlotId;
}

/** The parts of a canonical slot head id, or null when it is not one. */
export const parseSlotHeadId = (value: unknown): ParsedSlotHeadId | null => {
  if (typeof value !== "string") return null;
  const parts = value.split(SLOT_HEAD_ID_SEPARATOR);
  if (parts.length !== 3) return null;
  const [planId, date, slotId] = parts;
  return isNutritionDocId(planId) && isNutritionDate(date) && isNutritionSlotId(slotId)
    ? { planId, date, slotId }
    : null;
};
