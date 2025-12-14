import { supabase } from '@/integrations/supabase/client';
import { queryKeys } from '@/lib/queryKeys';

// Define payloads strictly
type ToggleSetPayload = {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  setNumber: number;
  repsCompleted: number;
  weightUsed?: number | null;
  completed: boolean;
};

type ToggleDayPayload = {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
  completed: boolean;
  durationMinutes?: number;
  caloriesBurned?: number;
};

// Map action types to handler functions
export const handlers = {
  'TOGGLE_SET': async (payload: ToggleSetPayload) => {
    const { data, error } = await supabase.functions.invoke('toggle-set', {
      body: payload
    });

    if (error || !data?.success) throw new Error('Sync failed');

    // Return keys to invalidate
    return [
      queryKeys.sets.byDay(payload.planId, payload.weekKey, payload.dayIndex),
      queryKeys.completion.byWeek(payload.planId, payload.weekKey)
    ];
  },

  'TOGGLE_DAY_COMPLETION': async (payload: ToggleDayPayload) => {
    const { data, error } = await supabase.functions.invoke('toggle-exercise', {
      body: payload
    });

    if (error || !data?.success) throw new Error('Sync failed');

    return [
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
      queryKeys.logs.byPlan(payload.planId)
    ];
  },
};