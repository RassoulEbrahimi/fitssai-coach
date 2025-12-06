import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getBerlinToday, getWorkoutDateString } from "../_shared/dateUtils.ts";

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

// Default values for duration and calories (legacy fallback)
const DEFAULT_DURATION_MINUTES = 10;
const DEFAULT_CALORIES_BURNED = 50;

// Validation schema
const ToggleExerciseSchema = z.object({
  planId: z.string().uuid('Invalid plan ID format'),
  weekKey: z.string().regex(/^Week [1-4]$/, 'Week key must be "Week 1", "Week 2", "Week 3", or "Week 4"'),
  dayIndex: z.number().int().min(0).max(6, 'Day index must be between 0 and 6'),
  exerciseIndex: z.number().int().min(0, 'Exercise index must be non-negative'),
  completed: z.boolean('Completed must be a boolean'),
  durationMinutes: z.number().int().min(0).max(480).optional(), // 0-8 hours
  caloriesBurned: z.number().int().min(0).max(5000).optional(), // 0-5000 cals
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
    const validation = ToggleExerciseSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return fail(`Validation error: ${errors}`, 'VALIDATION_ERROR');
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

    // Use provided values or fall back to defaults
    const finalDuration = durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const finalCalories = caloriesBurned ?? DEFAULT_CALORIES_BURNED;

    console.log(`Toggling exercise for user ${user.id}, plan ${planId}, ${weekKey} day ${dayIndex} exercise ${exerciseIndex} to ${completed} (duration: ${finalDuration}m, calories: ${finalCalories})`);

    // Fetch workout plan to get created_at for date calculation
    const { data: plan, error: planError } = await sb
      .from('workout_plans')
      .select('id, created_at')
      .eq('id', planId)
      .eq('user_id', user.id)
      .single();

    if (planError || !plan) {
      console.error('Plan fetch error:', planError);
      return fail('Plan nicht gefunden', 'PLAN_NOT_FOUND');
    }

    // Calculate workout_day using Berlin timezone and plan-based date calculation
    const workoutDay = getWorkoutDateString(plan.created_at, weekKey, dayIndex);
    const completedAt = completed ? new Date().toISOString() : null;

    console.log(`[toggle-exercise] Workout day (Berlin): ${workoutDay}, completed_at: ${completedAt}`);

    // Use upsert to handle both insert and update
    const { data, error } = await sb
      .from('workout_logs')
      .upsert({
        user_id: user.id,
        plan_id: planId,
        week_key: weekKey,
        day_index: dayIndex,
        exercise_index: exerciseIndex,
        completed,
        completed_at: completedAt,
        workout_day: workoutDay, // Berlin-based date calculation
        duration_minutes: finalDuration,
        calories_burned: finalCalories,
      }, {
        onConflict: 'user_id,plan_id,week_key,day_index,exercise_index',
      });

    if (error) {
      console.error('Database error:', error);
      return fail('Fehler beim Speichern der Übungsverläufe', 'DB_ERROR');
    }

    return ok({
      message: completed ? 'Übung abgeschlossen' : 'Übung zurückgesetzt'
    });

  } catch (error) {
    console.error('Error in toggle-exercise function:', error);
    return fail('Unerwarteter Fehler beim Umschalten der Übung', 'UNEXPECTED_ERROR');
  }
});