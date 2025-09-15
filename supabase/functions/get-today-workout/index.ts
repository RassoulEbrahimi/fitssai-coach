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

    // Parse request body for target date
    let targetDate = new Date().toISOString().split('T')[0]; // Default to today
    try {
      const body = await req.json();
      if (body.date) {
        targetDate = body.date;
      }
    } catch (e) {
      // Use default date
    }

    console.log(`Fetching workout for user ${user.id} on date ${targetDate}`);

    // Get user's latest workout plan
    const { data: workoutPlan, error: planError } = await sb
      .from('workout_plans')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (planError || !workoutPlan) {
      return ok({
        weekday: getGermanWeekday(new Date(targetDate)),
        fullDate: formatGermanDate(new Date(targetDate)),
        exercises: [],
        isRestDay: true,
        isToday: isToday(targetDate),
        message: 'Ruhetag — Kein Training für heute geplant'
      });
    }

    // Find today's workout in the plan
    const todayWorkout = findWorkoutForDate(workoutPlan.content, workoutPlan.created_at, targetDate);
    
    if (!todayWorkout || !todayWorkout.exercises || todayWorkout.exercises.length === 0) {
      return ok({
        weekday: getGermanWeekday(new Date(targetDate)),
        fullDate: formatGermanDate(new Date(targetDate)),
        exercises: [],
        isRestDay: true,
        isToday: isToday(targetDate),
        message: 'Ruhetag — Kein Training für heute geplant'
      });
    }

    // Get exercise completion logs for this date
    const { data: logs, error: logsError } = await sb
      .from('workout_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('plan_id', workoutPlan.id)
      .eq('workout_day', targetDate);

    if (logsError) {
      console.error('Error fetching logs:', logsError);
    }

    // Build exercises with completion status and unique IDs
    const exercises = todayWorkout.exercises.map((exercise: any, index: number) => ({
      id: `${workoutPlan.id}-${targetDate}-${index}`,
      name: exercise.name,
      sets: exercise.sets,
      reps: exercise.reps,
      weight: exercise.weight || '',
      rest: exercise.rest || '',
      completed: logs?.some(log => log.exercise_index === index && log.completed) || false
    }));

    return ok({
      weekday: getGermanWeekday(new Date(targetDate)),
      fullDate: formatGermanDate(new Date(targetDate)),
      exercises,
      isRestDay: false,
      isToday: isToday(targetDate),
      planId: workoutPlan.id
    });

  } catch (error) {
    console.error('Error in get-today-workout function:', error);
    return fail('Unerwarteter Fehler beim Laden des Trainings', 'UNEXPECTED_ERROR');
  }
});

function getGermanWeekday(date: Date): string {
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  return weekdays[date.getDay()];
}

function formatGermanDate(date: Date): string {
  const weekday = getGermanWeekday(date);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${weekday} ${day}.${month}.${year}`;
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

function findWorkoutForDate(planContent: any, planCreatedAt: string, targetDate: string): any {
  if (!planContent) return null;

  const planStart = new Date(planCreatedAt);
  const target = new Date(targetDate);
  const daysDiff = Math.floor((target.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24));
  
  // Calculate week and day within plan
  const weekIndex = Math.floor(daysDiff / 7);
  const dayIndex = daysDiff % 7;
  
  // Look for the week in plan content
  const weekKeys = [`Week ${weekIndex + 1}`, `week${weekIndex + 1}`, `week ${weekIndex + 1}`];
  let weekData = null;
  
  for (const key of weekKeys) {
    if (planContent[key]) {
      weekData = planContent[key];
      break;
    }
  }
  
  if (!weekData || !Array.isArray(weekData) || dayIndex >= weekData.length) {
    return null;
  }
  
  return weekData[dayIndex];
}