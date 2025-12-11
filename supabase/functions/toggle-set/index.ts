import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getWorkoutDateString } from "../_shared/dateUtils.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (obj: Record<string, any> = {}) => json({ success: true, ...obj }, 200);
const fail = (message: string, code?: string) =>
  json({ success: false, error: message, code }, 200);

// Validation schema for toggling a set
const ToggleSetSchema = z.object({
  planId: z.string().uuid('Invalid plan ID format'),
  weekKey: z.string().regex(/^Week [1-4]$/, 'Week key must be "Week 1", "Week 2", "Week 3", or "Week 4"'),
  dayIndex: z.number().int().min(0).max(6, 'Day index must be between 0 and 6'),
  exerciseIndex: z.number().int().min(0, 'Exercise index must be non-negative'),
  setNumber: z.number().int().min(1, 'Set number must be at least 1'),
  repsCompleted: z.number().int().min(0, 'Reps must be non-negative'),
  weightUsed: z.number().min(0).max(1000).optional().nullable(), // 0-1000 kg
  completed: z.boolean('Completed must be a boolean'),
});

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Client for user auth
    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Get current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return fail('Nicht autorisiert', 'AUTH');
    }

    const body = await req.json();

    // Validate input
    const validation = ToggleSetSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return fail(`Validation error: ${errors}`, 'VALIDATION_ERROR');
    }

    const {
      planId,
      weekKey,
      dayIndex,
      exerciseIndex,
      setNumber,
      repsCompleted,
      weightUsed,
      completed,
    } = validation.data;

    console.log(`[toggle-set] User ${user.id}, plan ${planId}, set ${setNumber} to ${completed}`);

    // Fetch workout plan to get created_at for date calculation
    // We still need this to ensure the correct workout_day is passed to the RPC
    const { data: plan, error: planError } = await sb
      .from('workout_plans')
      .select('created_at')
      .eq('id', planId)
      .eq('user_id', user.id)
      .single();

    if (planError || !plan) {
      console.error('Plan fetch error:', planError);
      return fail('Plan nicht gefunden', 'PLAN_NOT_FOUND');
    }

    // Calculate workout_day
    const workoutDay = getWorkoutDateString(plan.created_at, weekKey, dayIndex);

    // Call RPC to handle all DB logic
    const { data: rpcResult, error: rpcError } = await sb.rpc('rpc_toggle_set_and_count', {
      p_user_id: user.id,
      p_plan_id: planId,
      p_week_key: weekKey,
      p_day_index: dayIndex,
      p_exercise_index: exerciseIndex,
      p_set_number: setNumber,
      p_reps_completed: repsCompleted,
      p_weight_used: weightUsed,
      p_completed: completed,
      p_workout_day: workoutDay
    });

    if (rpcError) {
      console.error('RPC Error:', rpcError);
      return fail('Datenbankfehler beim Speichern', 'DB_ERROR');
    }

    return ok({
      success: true,
      ...rpcResult
    });

  } catch (error) {
    console.error('Error in toggle-set function:', error);
    return fail('Unerwarteter Fehler', 'UNEXPECTED_ERROR');
  }
});
