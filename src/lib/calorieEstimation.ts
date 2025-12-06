/**
 * Calorie estimation based on exercise type and duration
 */

type BurnCategory = 'high' | 'medium' | 'low';

interface BurnRateConfig {
  keywords: string[];
  caloriesPerMinute: number;
}

const BURN_RATES: Record<BurnCategory, BurnRateConfig> = {
  high: {
    keywords: ['hiit', 'cardio', 'running', 'laufen', 'sprint', 'burpee', 'jumping', 'box jump', 'mountain climber', 'kettlebell', 'rowing', 'rudern', 'cycling', 'radfahren', 'seilspringen', 'jump rope'],
    caloriesPerMinute: 12,
  },
  medium: {
    keywords: ['squat', 'kniebeuge', 'deadlift', 'kreuzheben', 'bench', 'bankdrücken', 'press', 'drücken', 'pull', 'row', 'rudern', 'lunge', 'ausfallschritt', 'curl', 'dip', 'push-up', 'liegestütz', 'plank', 'core', 'abs', 'bauch', 'shoulder', 'schulter', 'back', 'rücken', 'leg', 'bein', 'arm', 'chest', 'brust'],
    caloriesPerMinute: 7,
  },
  low: {
    keywords: ['yoga', 'stretch', 'dehnung', 'mobility', 'mobilität', 'foam', 'roll', 'cooldown', 'warm-up', 'aufwärmen', 'meditation', 'breathing', 'atmung', 'relaxation', 'entspannung'],
    caloriesPerMinute: 3,
  },
};

const DEFAULT_CALORIES_PER_MINUTE = 5;

/**
 * Estimates calories burned based on exercise name and duration
 * @param exerciseName - Name of the exercise
 * @param durationMinutes - Duration in minutes
 * @returns Estimated calories burned (rounded to nearest integer)
 */
export function estimateCalories(exerciseName: string, durationMinutes: number): number {
  const lowerName = exerciseName.toLowerCase();
  
  // Check each category for matching keywords
  for (const [, config] of Object.entries(BURN_RATES)) {
    for (const keyword of config.keywords) {
      if (lowerName.includes(keyword)) {
        return Math.round(durationMinutes * config.caloriesPerMinute);
      }
    }
  }
  
  // Default to medium-low burn rate if no keywords match
  return Math.round(durationMinutes * DEFAULT_CALORIES_PER_MINUTE);
}
