// src/lib/queryKeys.ts

export const queryKeys = {
  // 1. Workout Plans (Root)
  plans: {
    all: ['workout-plans'] as const,
    byUser: (userId: string | undefined) => ['workout-plans', userId] as const,
  },

  // 2. Workout Logs (History & Status)
  logs: {
    all: ['workout-logs'] as const,
    byPlan: (planId: string | undefined, userId?: string) => 
      ['workout-logs', userId, planId].filter(Boolean) as const,
  },

  // 3. Week Completion (Dashboard Circles)
  completion: {
    all: ['week-completion'] as const,
    byPlan: (planId: string | undefined) => 
      ['week-completion', planId] as const,
    byWeek: (planId: string | undefined, weekKey: string) => 
      ['week-completion', planId, weekKey] as const,
  },

  // 4. Workout Sets (Specific Exercises)
  sets: {
    all: ['workout-sets'] as const,
    byPlan: (planId: string | undefined) => 
      ['workout-sets', planId] as const,
    byDay: (planId: string | undefined, weekKey: string, dayIndex: number) => 
      ['workout-sets', planId, weekKey, dayIndex] as const,
  },

  // 5. User Profile
  profile: {
    me: (userId: string | undefined) => ['profile', userId] as const,
  }
};

// Type helper for consistency in hooks
export type QueryKeys = typeof queryKeys;