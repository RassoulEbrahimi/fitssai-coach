import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    // Parse request body
    const body = await req.json();
    const { planId, workoutDay, exerciseIndex, completed } = body;

    if (!planId || !workoutDay || exerciseIndex === undefined) {
      return fail('Fehlende Parameter', 'MISSING_PARAMS');
    }

    console.log(`Toggling exercise ${exerciseIndex} for user ${user.id} on ${workoutDay} to ${completed}`);

    // Check if log already exists
    const { data: existingLog, error: fetchError } = await sb
      .from('workout_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('plan_id', planId)
      .eq('workout_day', workoutDay)
      .eq('exercise_index', exerciseIndex)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching existing log:', fetchError);
      return fail('Fehler beim Laden der Daten', 'FETCH_ERROR');
    }

    if (existingLog) {
      // Update existing log
      const { error: updateError } = await sb
        .from('workout_logs')
        .update({
          completed,
          completed_at: completed ? new Date().toISOString() : null
        })
        .eq('id', existingLog.id);

      if (updateError) {
        console.error('Error updating log:', updateError);
        return fail('Fehler beim Aktualisieren', 'UPDATE_ERROR');
      }
    } else {
      // Create new log
      const { error: insertError } = await sb
        .from('workout_logs')
        .insert({
          user_id: user.id,
          plan_id: planId,
          workout_day: workoutDay,
          exercise_index: exerciseIndex,
          completed,
          completed_at: completed ? new Date().toISOString() : null
        });

      if (insertError) {
        console.error('Error inserting log:', insertError);
        return fail('Fehler beim Speichern', 'INSERT_ERROR');
      }
    }

    // Get updated weekly progress
    const weeklyProgress = await calculateWeeklyProgress(sb, user.id, planId, workoutDay);

    return ok({ 
      completed,
      weeklyProgress,
      message: completed ? 'Übung abgeschlossen' : 'Übung zurückgesetzt'
    });

  } catch (error) {
    console.error('Error in toggle-exercise function:', error);
    return fail('Unerwarteter Fehler', 'UNEXPECTED_ERROR');
  }
});

async function calculateWeeklyProgress(sb: any, userId: string, planId: string, workoutDay: string) {
  // Calculate the start and end of the week for the given workout day
  const targetDate = new Date(workoutDay);
  const startOfWeek = new Date(targetDate);
  startOfWeek.setDate(targetDate.getDate() - targetDate.getDay() + 1); // Monday
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday

  const startStr = startOfWeek.toISOString().split('T')[0];
  const endStr = endOfWeek.toISOString().split('T')[0];

  // Get completed exercises for this week
  const { data: logs, error } = await sb
    .from('workout_logs')
    .select('workout_day, exercise_index')
    .eq('user_id', userId)
    .eq('plan_id', planId)
    .eq('completed', true)
    .gte('workout_day', startStr)
    .lte('workout_day', endStr);

  if (error) {
    console.error('Error calculating weekly progress:', error);
    return { completed: 0, total: 0 };
  }

  // Count unique days with completed exercises
  const completedDays = new Set((logs || []).map(log => log.workout_day)).size;
  
  // For simplicity, assume 5 workout days per week (Monday-Friday)
  // In production, this should be calculated from the actual plan
  const totalWorkoutDays = 5;

  return {
    completed: Math.min(completedDays, totalWorkoutDays),
    total: totalWorkoutDays
  };
}