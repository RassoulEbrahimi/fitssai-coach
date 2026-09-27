import type { FitnessGoal } from "../fitnessGoal";
import type { NutritionTargetMode, ProfileFingerprint, TargetPolicyRef, TargetVersion } from "./contracts";
import type { BiologicalSex, NutritionActivityLevel, NutritionProfile, ProfileAnswer } from "./profile";

/**
 * The profile fingerprint of a target: whether the profile answers a target
 * was computed from have changed since.
 *
 * A target stores only the SHA-256 of its fingerprint material and the names
 * of the fields that material covers — never the answers themselves. Comparing
 * means rebuilding the material from the current profile and hashing it again.
 *
 * The material is a canonical string: the mode, the policy id and version,
 * the sorted field names and, per field, its normalised answer. It is built
 * from arrays in a fixed order, never from object key order, so the same
 * answers give the same hash on the server, in the browser and in tests.
 *
 * Pure. Hashing is injected (`Sha256Hex`): the server passes Node's SHA-256,
 * the browser Web Crypto's, so this module needs neither.
 */

/* ------------------------------------------------------------------ *
 * The closed field vocabulary
 * ------------------------------------------------------------------ */

/**
 * The profile fields a target policy may read, and so the only fields a
 * fingerprint can cover. Closed: nothing else in the profile document is
 * reachable by name. Generation inputs (dietary preference, meals per day,
 * exclusions) are deliberately not here.
 */
export const NUTRITION_TARGET_PROFILE_FIELDS = [
  "age",
  "height",
  "weight",
  "biologicalSex",
  "fitnessGoal",
  "activityLevel",
  "nutritionTargetMode",
  "manualTargetKcal",
] as const;

export type NutritionTargetProfileField = (typeof NUTRITION_TARGET_PROFILE_FIELDS)[number];

/** The answered value of each target profile field, as `parseNutritionProfile` normalises it. */
export interface NutritionTargetProfileValues {
  age: number;
  height: number;
  weight: number;
  biologicalSex: BiologicalSex;
  fitnessGoal: FitnessGoal;
  activityLevel: NutritionActivityLevel;
  nutritionTargetMode: NutritionTargetMode;
  manualTargetKcal: number;
}

export const isNutritionTargetProfileField = (value: unknown): value is NutritionTargetProfileField =>
  typeof value === "string" && (NUTRITION_TARGET_PROFILE_FIELDS as readonly string[]).includes(value);

/**
 * One field of the Nutrition profile, by its vocabulary name. An explicit
 * switch rather than a property lookup, so no other key of the profile can be
 * reached through here.
 */
export const readNutritionTargetProfileField = (
  profile: NutritionProfile,
  field: NutritionTargetProfileField
): ProfileAnswer<NutritionTargetProfileValues[NutritionTargetProfileField]> => {
  switch (field) {
    case "age":
      return profile.age;
    case "height":
      return profile.height;
    case "weight":
      return profile.weight;
    case "biologicalSex":
      return profile.biologicalSex;
    case "fitnessGoal":
      return profile.fitnessGoal;
    case "activityLevel":
      return profile.activityLevel;
    case "nutritionTargetMode":
      return profile.nutritionTargetMode;
    case "manualTargetKcal":
      return profile.manualTargetKcal;
  }
};

/** Sorted and without duplicates: the one order field names are hashed and stored in. */
export const canonicalTargetProfileFields = <F extends string>(fields: readonly F[]): F[] =>
  [...new Set(fields)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/* ------------------------------------------------------------------ *
 * Resolving a policy's inputs
 * ------------------------------------------------------------------ */

export type NutritionTargetProfileInputs =
  | {
      status: "complete";
      /** Canonical field order. */
      fields: NutritionTargetProfileField[];
      values: Partial<NutritionTargetProfileValues>;
    }
  | {
      status: "incomplete";
      /** Names only, canonical order: no value is stored. */
      missingFields: NutritionTargetProfileField[];
      /** Names only, canonical order: something is stored, but it is not an answer. */
      invalidFields: NutritionTargetProfileField[];
    };

/**
 * The answers to `fields`, or which of them are missing or invalid. Nothing
 * is defaulted: a field that is not answered makes the inputs incomplete.
 */
export const resolveNutritionTargetProfileInputs = (
  profile: NutritionProfile,
  fields: readonly NutritionTargetProfileField[]
): NutritionTargetProfileInputs => {
  const canonical = canonicalTargetProfileFields(fields);
  const values: Partial<Record<NutritionTargetProfileField, unknown>> = {};
  const missingFields: NutritionTargetProfileField[] = [];
  const invalidFields: NutritionTargetProfileField[] = [];

  for (const field of canonical) {
    const answer = readNutritionTargetProfileField(profile, field);
    if (answer.status === "answered") values[field] = answer.value;
    else if (answer.status === "missing") missingFields.push(field);
    else invalidFields.push(field);
  }

  if (missingFields.length > 0 || invalidFields.length > 0) return { status: "incomplete", missingFields, invalidFields };
  return { status: "complete", fields: canonical, values: values as Partial<NutritionTargetProfileValues> };
};

/* ------------------------------------------------------------------ *
 * Fingerprint material and hash
 * ------------------------------------------------------------------ */

/** Hex SHA-256 of a UTF-8 string. Injected: Node's on the server, Web Crypto's in the browser. */
export type Sha256Hex = (text: string) => Promise<string>;

/** Bumped only if the material's layout ever changes; part of the material itself. */
export const NUTRITION_TARGET_FINGERPRINT_FORMAT = 1;

export interface NutritionTargetFingerprintInput {
  mode: NutritionTargetMode;
  policy: TargetPolicyRef;
  /** The answered values of exactly the policy's required fields. */
  values: Partial<NutritionTargetProfileValues>;
  fields: readonly NutritionTargetProfileField[];
}

/**
 * The canonical string that is hashed. Only arrays with a fixed order go into
 * it, so neither property order nor the order `fields` arrive in can change
 * it. It contains answers, so it is hashed and never stored.
 */
export const nutritionTargetFingerprintMaterial = ({ mode, policy, values, fields }: NutritionTargetFingerprintInput): string => {
  const canonical = canonicalTargetProfileFields(fields);
  return JSON.stringify([
    "fitssai.nutrition.targetFingerprint",
    NUTRITION_TARGET_FINGERPRINT_FORMAT,
    mode,
    [policy.id, policy.version],
    canonical,
    canonical.map((field) => [field, values[field] ?? null]),
  ]);
};

/** What a target persists about its inputs: the hash and the field names. */
export const computeNutritionTargetFingerprint = async (
  input: NutritionTargetFingerprintInput,
  sha256Hex: Sha256Hex
): Promise<ProfileFingerprint> => ({
  hash: await sha256Hex(nutritionTargetFingerprintMaterial(input)),
  fields: canonicalTargetProfileFields(input.fields),
});

/* ------------------------------------------------------------------ *
 * Freshness
 * ------------------------------------------------------------------ */

/**
 * Whether a target still matches the profile it was computed from.
 *
 *   fresh          the current answers hash to the target's fingerprint
 *   stale          every field is answered, but the answers changed
 *   cannotCompare  a field the target used is now missing, invalid or not
 *                  known to this build — never reported as fresh
 *
 * Derived only. Nothing is written, recalculated or replaced: the target stays
 * the person's current target until they explicitly set a new one.
 */
export type NutritionTargetFreshness =
  | { status: "fresh" }
  | { status: "stale" }
  | {
      status: "cannotCompare";
      /** Names only. */
      missingFields: NutritionTargetProfileField[];
      invalidFields: NutritionTargetProfileField[];
      unknownFields: string[];
    };

/** The parts of a target that freshness reads. */
export type NutritionTargetFingerprinted = Pick<TargetVersion, "mode" | "policy" | "profileFingerprint">;

export const deriveNutritionTargetFreshness = async (
  target: NutritionTargetFingerprinted,
  profile: NutritionProfile,
  sha256Hex: Sha256Hex
): Promise<NutritionTargetFreshness> => {
  const fields = target.profileFingerprint.fields;
  const unknownFields = fields.filter((field) => !isNutritionTargetProfileField(field));
  const known = fields.filter(isNutritionTargetProfileField);
  const inputs = resolveNutritionTargetProfileInputs(profile, known);

  if (unknownFields.length > 0 || inputs.status === "incomplete") {
    return {
      status: "cannotCompare",
      missingFields: inputs.status === "incomplete" ? inputs.missingFields : [],
      invalidFields: inputs.status === "incomplete" ? inputs.invalidFields : [],
      unknownFields,
    };
  }

  const current = await computeNutritionTargetFingerprint(
    { mode: target.mode, policy: target.policy, fields: inputs.fields, values: inputs.values },
    sha256Hex
  );
  return current.hash === target.profileFingerprint.hash ? { status: "fresh" } : { status: "stale" };
};
