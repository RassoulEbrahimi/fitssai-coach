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

  // 8. Nutrition V2. One account-scoped root, so `nutrition.all(uid)` reaches
  // every V2 query of that account and nothing else. A resolved day has no key
  // on purpose: it is derived from plan, slots and entries, not fetched.
  nutrition: {
    all: (userId: string | undefined) => ['nutrition-v2', userId] as const,
    state: (userId: string | undefined) => ['nutrition-v2', userId, 'state'] as const,
    targets: {
      all: (userId: string | undefined) => ['nutrition-v2', userId, 'targets'] as const,
      current: (userId: string | undefined) => ['nutrition-v2', userId, 'targets', 'current'] as const,
    },
    plans: {
      all: (userId: string | undefined) => ['nutrition-v2', userId, 'plans'] as const,
      active: (userId: string | undefined) => ['nutrition-v2', userId, 'plans', 'active'] as const,
      byId: (userId: string | undefined, planId: string | undefined) =>
        ['nutrition-v2', userId, 'plans', 'byId', planId] as const,
    },
    slots: {
      byPlan: (userId: string | undefined, planId: string | undefined) =>
        ['nutrition-v2', userId, 'slots', planId] as const,
    },
    entries: {
      all: (userId: string | undefined) => ['nutrition-v2', userId, 'entries'] as const,
      byDate: (userId: string | undefined, date: string) =>
        ['nutrition-v2', userId, 'entries', 'byDate', date] as const,
      range: (userId: string | undefined, from: string, to: string) =>
        ['nutrition-v2', userId, 'entries', 'range', from, to] as const,
    },
    generation: {
      active: (userId: string | undefined) => ['nutrition-v2', userId, 'generation', 'active'] as const,
      byId: (userId: string | undefined, requestId: string | undefined) =>
        ['nutrition-v2', userId, 'generation', 'byId', requestId] as const,
    },
    suggestions: (userId: string | undefined, planId: string | undefined, date: string, slotId: string) =>
      ['nutrition-v2', userId, 'suggestions', planId, date, slotId] as const,
  },

  // 9. Legacy Nutrition. Its own root, deliberately not under `nutrition`, so no
  // V2 invalidation can reach it. The key is the one legacy has always used.
  nutritionLegacy: {
    latest: (userId: string | undefined) => ['nutrition-plan', userId] as const,
  },
};

// Type helper for consistency in hooks
export type QueryKeys = typeof queryKeys;