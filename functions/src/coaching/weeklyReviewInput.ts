import { z } from "zod";
import {
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_FOCUSES,
} from "../../../shared/weeklyRecommendation";
import { EXPERIENCE_LEVELS, FITNESS_GOALS } from "./planGenerationInput";

/**
 * The minimum a coach needs to phrase one weekly recommendation.
 *
 * Data minimisation again, and for the same reason as plan generation: what is
 * absent from this object can never appear in a prompt. No name, no email, no
 * uid, no age, height or weight, no exercise names, no raw log documents — a
 * sentence about "two of three sessions" does not become truer for knowing how
 * much the person weighs.
 *
 * Every numeric field is a value the backend computed itself from persisted
 * records. The model is handed the arithmetic, the category the deterministic
 * rules chose and the wording angle that goes with it; it is never asked to
 * produce any of the three.
 *
 * Note what the model is *not* given, because the app does not have it:
 * perceived effort, fatigue, recovery, sleep, injury status, or why a session
 * was missed. A field that does not exist cannot be reasoned from — which is
 * the point, since a completion tally is adherence data and nothing more.
 */
export const weeklyReviewInputSchema = z
  .object({
    /** Which week of the four-week programme. Positional, not a date. */
    weekNumber: z.number().int().min(1).max(4),
    scheduledDays: z.number().int().min(0).max(7),
    completedDays: z.number().int().min(0).max(7),
    missedDays: z.number().int().min(0).max(7),
    completionPercent: z.number().int().min(0).max(100),
    /** Only when sessions actually carried a measured length. */
    measuredDurationMinutes: z.number().int().min(0).max(2000).optional(),
    measuredSessionCount: z.number().int().min(0).max(7).optional(),
    /** Only when the plan has a preceding week. */
    previousWeekCompletionPercent: z.number().int().min(0).max(100).optional(),
    goal: z.enum(FITNESS_GOALS).optional(),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
    /** The conclusion the rules reached. The model may only phrase it. */
    category: z.enum(RECOMMENDATION_CATEGORIES),
    /** Which true sentence leads, within that category. Also already decided. */
    focus: z.enum(RECOMMENDATION_FOCUSES),
  })
  .strict();

export type WeeklyReviewInput = z.infer<typeof weeklyReviewInputSchema>;
