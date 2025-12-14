import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getBerlinToday } from "../_shared/dateUtils.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const ok = (obj: Record<string, any> = {}) => json({ success: true, ...obj }, 200);
const fail = (message: string, code?: string) =>
  json({ success: false, error: message, code }, 200);

// Validation schema
const GetWorkoutSchema = z.object({
  weekKey: z.string().regex(/^Week [1-4]$/, 'Week key must be "Week 1", "Week 2", "Week 3", or "Week 4"'),
  dayIndex: z.number().int().min(0).max(6, 'Day index must be between 0 and 6'),
  planId: z.string().uuid('Invalid plan ID format'),
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

    // Parse request body
    const body = await req.json();

    // Validate input
    const validation = GetWorkoutSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return fail(`Validation error: ${errors}`, 'VALIDATION_ERROR');
    }

    const { weekKey, dayIndex, planId } = validation.data;

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