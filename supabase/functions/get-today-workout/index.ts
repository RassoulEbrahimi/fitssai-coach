import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getBerlinToday } from "../_shared/dateUtils.ts";

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

    // Parse request body for weekKey, dayIndex, and planId
    const body = await req.json();
    const { weekKey, dayIndex, planId } = body;

    // SAFEGUARD: weekKey and dayIndex are the real selected week/day.
    // We fetch completion status for the actual selected week, not any mirror source.
    if (!weekKey || dayIndex === undefined || !planId) {
      return fail('weekKey, dayIndex und planId sind erforderlich', 'MISSING_PARAMS');
    }

    console.log(`Loading completion map for user ${user.id}, plan ${planId}, ${weekKey} day ${dayIndex}`);

    // Get exercise completion logs for this week/day combination
    const { data: logs, error: logsError } = await sb
      .from('workout_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('plan_id', planId)
      .eq('week_key', weekKey)
      .eq('day_index', dayIndex);

    if (logsError) {
      console.error('Error fetching logs:', logsError);
      return fail('Fehler beim Laden der Übungsverläufe', 'LOGS_ERROR');
    }

    // Build completion map indexed by exercise_index
    const completionMap: Record<string, boolean> = {};
    logs?.forEach(log => {
      if (log.exercise_index !== null) {
        completionMap[log.exercise_index.toString()] = log.completed;
      }
    });

    return ok({
      completionMap
    });

  } catch (error) {
    console.error('Error in get-today-workout function:', error);
    return fail('Unerwarteter Fehler beim Laden der Vervollständigungsdaten', 'UNEXPECTED_ERROR');
  }
});