import { z } from "zod";

/**
 * The minimum a coach needs to propose a four-week plan.
 *
 * Data minimisation is the point of this file. A future provider receives this
 * object and nothing else, so what is absent here can never leak into a
 * prompt: no name, no email, no uid, no height or weight, no nutrition
 * preferences, and no raw workout history. None of those improve a training
 * split enough to justify sending them to a third party.
 *
 * The values mirror what the profile already collects after PR48/PR49, so
 * building this input requires no new question and no new stored field.
 */

export const FITNESS_GOALS = ["gainMuscle", "loseFat", "improveCardio", "maintain"] as const;
export type FitnessGoal = (typeof FITNESS_GOALS)[number];

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

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

export const planGenerationInputSchema = z
  .object({
    goal: z.enum(FITNESS_GOALS),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
    equipment: z.array(z.enum(EQUIPMENT_TYPES)).min(1),
    daysPerWeek: z.number().int().min(1).max(7),
    sessionMinutes: z.number().int().min(15).max(180),
  })
  .strict();

export type PlanGenerationInput = z.infer<typeof planGenerationInputSchema>;

/**
 * Fields that must never reach a provider, listed so a test can enforce it.
 *
 * A guard that reads this list fails loudly the day somebody widens the input
 * "just for context", which is exactly how personal data ends up in a prompt.
 */
export const FORBIDDEN_PROVIDER_FIELDS = [
  "uid",
  "userId",
  "email",
  "name",
  "fullName",
  "displayName",
  "height",
  "weight",
  "dateOfBirth",
  "dietaryPreference",
  "workoutLogs",
] as const;
