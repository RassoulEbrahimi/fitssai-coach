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

    const body = await req.json();
    const { planId, weekKey, dayIndex, exerciseIndex, completed } = body;

    if (!planId || !weekKey || dayIndex === undefined || exerciseIndex === undefined || completed === undefined) {
      return fail('planId, weekKey, dayIndex, exerciseIndex und completed sind erforderlich', 'MISSING_PARAMS');
    }

    console.log(`Toggling exercise for user ${user.id}, plan ${planId}, ${weekKey} day ${dayIndex} exercise ${exerciseIndex} to ${completed}`);

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
        completed_at: completed ? new Date().toISOString() : null,
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