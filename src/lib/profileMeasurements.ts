import { z } from "zod";

/**
 * The age, weight and height a person may enter, exactly as onboarding has
 * always accepted them: whole numbers within these bounds, in years,
 * kilograms and centimetres.
 *
 * Shared by onboarding and the Nutrition profile completion, so the two
 * never disagree about what a valid answer is. Validation messages live
 * under `onboarding.validation.{age,weight,height}.*`, keyed by the zod issue
 * code (`too_small`, `too_big`, `invalid_type` for a fraction).
 */
export const profileAgeSchema = z.number().int().min(13).max(120);
export const profileWeightSchema = z.number().int().min(30).max(300);
export const profileHeightSchema = z.number().int().min(100).max(250);
