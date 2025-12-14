import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getWorkoutDateString } from "../_shared/dateUtils.ts";

// --- Types ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (data: Record<string, unknown>) => json({ success: true, ...data });
const fail = (message: string, status = 400, details?: unknown) => 
  json({ success: false, error: message, details }, status);

// --- Constants ---
const DEFAULT_DURATION_MINUTES = 10;
const DEFAULT_CALORIES_BURNED = 50;

// --- Validation ---
const ToggleExerciseSchema = z.object({
  planId: z.string().uuid('Invalid plan ID format'),
  weekKey: z.string().regex(/^Week [1-4]$/, 'Week key must be "Week 1" to "Week 4"'),
  dayIndex: z.number().int().min(0).max(6),
  exerciseIndex: z.number().int().min(0),
  completed: z.boolean(),
  durationMinutes: z.number().int().min(0).max(480).optional(),
  caloriesBurned: z.number().int().min(0).max(5000).optional(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // 1. Setup & Auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return fail('Server configuration error', 500);
    }

    // Client for DB operations (Service Role)
    const sbAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Client for Auth Verification
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('Unauthorized', 401);

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // SECURITY CHECK: Get User
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return fail('Unauthorized', 401);
    }

    // 2. Parse & Validate
    const body = await req.json();
    const validation = ToggleExerciseSchema.safeParse(body);

    if (!validation.success) {
      return fail('Validation error', 400, validation.error.flatten());
    }

    const {
      planId,
      weekKey,
      dayIndex,
      exerciseIndex,
      completed,
      durationMinutes,
      caloriesBurned,
    } = validation.data;

    // 3. Logic
    const finalDuration = durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const finalCalories = caloriesBurned ?? DEFAULT_CALORIES_BURNED;

    // Fetch Plan (to calculate date) - Strictly scoped to user_id
    const { data: plan, error: planError } = await sbAdmin
      .from('workout_plans')
      .select('created_at')
      .eq('id', planId)
      .eq('user_id', user.id) // Security: Ensure user owns the plan
      .single();

    if (planError || !plan) {
      return fail('Plan not found or access denied', 404);
    }

    // Calculate Dates
    const workoutDay = getWorkoutDateString(plan.created_at, weekKey, dayIndex);
    const completedAt = completed ? new Date().toISOString() : null;

    // Upsert Log
    const { error: upsertError } = await sbAdmin
      .from('workout_logs')
      .upsert({
        user_id: user.id,
        plan_id: planId,
        week_key: weekKey,
        day_index: dayIndex,
        exercise_index: exerciseIndex,
        completed,
        completed_at: completedAt,
        workout_day: workoutDay,
        duration_minutes: finalDuration,
        calories_burned: finalCalories,
      }, {
        onConflict: 'user_id,plan_id,week_key,day_index,exercise_index',
      });

    if (upsertError) {
      console.error('DB Error:', upsertError);
      return fail('Failed to save progress', 500);
    }

    return ok({
      message: completed ? 'Exercise completed' : 'Exercise reset',
      state: { completed, workoutDay }
    });

  } catch (error) {
    console.error('Unexpected:', error);
    return fail('Internal server error', 500);
  }
});