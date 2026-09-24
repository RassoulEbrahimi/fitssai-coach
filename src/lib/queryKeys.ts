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
      ['workout-logs', userId, planId].filter(Boolean) as readonly string[],
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
  },

  // 6. Previous performance for a running workout: one lookup per account,
  // execution day and the exercise identities that day trains.
  previousPerformance: {
    all: ['previous-performance'] as const,
    byExecution: (
      userId: string | undefined,
      planId: string | undefined,
      weekKey: string,
      dayIndex: number,
      workoutDay: string | undefined,
      identityKeys: readonly (string | null)[]
    ) => ['previous-performance', userId, planId, weekKey, dayIndex, workoutDay, identityKeys] as const,
  },

  // 7. Workout History: the account's completed sessions, across plans.
  history: {
    all: (userId: string | undefined) => ['workout-history', userId] as const,
    list: (userId: string | undefined) => ['workout-history', userId, 'list'] as const,
    latest: (userId: string | undefined) => ['workout-history', userId, 'latest'] as const,
    session: (userId: string | undefined, planId: string | undefined, workoutDay: string | undefined) =>
      ['workout-history', userId, 'session', planId, workoutDay] as const,
  },
};

// Type helper for consistency in hooks
export type QueryKeys = typeof queryKeys;