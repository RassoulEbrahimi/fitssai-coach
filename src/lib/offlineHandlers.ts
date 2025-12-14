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

    if (error) throw error;
    if (!data?.success) throw new Error('Server returned failure');

    // Return keys to invalidate
    return [
      // Refresh the specific sets for that day
      queryKeys.sets.byDay(payload.planId, payload.weekKey, payload.dayIndex),
      // Also refresh the dashboard circles
      queryKeys.completion.byWeek(payload.planId, payload.weekKey)
    ];
  },

  'TOGGLE_DAY_COMPLETION': async (payload: ToggleDayPayload) => {
    const { data, error } = await supabase.functions.invoke('toggle-exercise', {
      body: payload
    });

    if (error) throw error;
    if (!data?.success) throw new Error('Server returned failure');

    return [
      // Refresh dashboard
      queryKeys.completion.byWeek(payload.planId, payload.weekKey),
      // Refresh logs history
      queryKeys.logs.byPlan(payload.planId)
    ];
  },
};