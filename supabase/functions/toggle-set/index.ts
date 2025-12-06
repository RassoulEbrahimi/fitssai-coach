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

    console.log(`[toggle-set] User ${user.id}, plan ${planId}, ${weekKey} day ${dayIndex} exercise ${exerciseIndex} set ${setNumber} to ${completed}`);

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

    // Calculate workout_day
    const workoutDay = getWorkoutDateString(plan.created_at, weekKey, dayIndex);

    // First, ensure there's a workout_log entry for this exercise
    // Use upsert to create if not exists
    const { data: workoutLog, error: logError } = await sb
      .from('workout_logs')
      .upsert({
        user_id: user.id,
        plan_id: planId,
        week_key: weekKey,
        day_index: dayIndex,
        exercise_index: exerciseIndex,
        completed: false, // Will be updated based on set completion
        workout_day: workoutDay,
        duration_minutes: 0,
        calories_burned: 0,
      }, {
        onConflict: 'user_id,plan_id,week_key,day_index,exercise_index',
      })
      .select('id')
      .single();

    if (logError) {
      console.error('Workout log upsert error:', logError);
      return fail('Fehler beim Erstellen des Übungsprotokolls', 'DB_ERROR');
    }

    // Get the workout_log_id (need to fetch it if upsert didn't return it)
    let workoutLogId = workoutLog?.id;
    if (!workoutLogId) {
      const { data: existingLog, error: fetchError } = await sb
        .from('workout_logs')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan_id', planId)
        .eq('week_key', weekKey)
        .eq('day_index', dayIndex)
        .eq('exercise_index', exerciseIndex)
        .single();

      if (fetchError || !existingLog) {
        console.error('Could not find workout log:', fetchError);
        return fail('Fehler beim Finden des Übungsprotokolls', 'DB_ERROR');
      }
      workoutLogId = existingLog.id;
    }

    if (completed) {
      // Insert or update the set log
      const { error: setError } = await sb
        .from('workout_set_logs')
        .upsert({
          workout_log_id: workoutLogId,
          user_id: user.id,
          set_number: setNumber,
          reps_completed: repsCompleted,
          weight_used: weightUsed ?? null,
          completed_at: new Date().toISOString(),
        }, {
          onConflict: 'workout_log_id,set_number',
        });

      if (setError) {
        console.error('Set log insert error:', setError);
        return fail('Fehler beim Speichern des Satzes', 'DB_ERROR');
      }
    } else {
      // Delete the set log
      const { error: deleteError } = await sb
        .from('workout_set_logs')
        .delete()
        .eq('workout_log_id', workoutLogId)
        .eq('set_number', setNumber);

      if (deleteError) {
        console.error('Set log delete error:', deleteError);
        return fail('Fehler beim Löschen des Satzes', 'DB_ERROR');
      }
    }

    // Fetch all set logs for this workout to determine overall completion
    const { data: allSets, error: setsError } = await sb
      .from('workout_set_logs')
      .select('id')
      .eq('workout_log_id', workoutLogId);

    const completedSetsCount = allSets?.length ?? 0;

    return ok({
      message: completed ? 'Satz abgeschlossen' : 'Satz zurückgesetzt',
      workoutLogId,
      completedSetsCount,
    });

  } catch (error) {
    console.error('Error in toggle-set function:', error);
    return fail('Unerwarteter Fehler', 'UNEXPECTED_ERROR');
  }
});
