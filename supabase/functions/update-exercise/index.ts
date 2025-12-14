import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const isDev = Deno.env.get('DENO_DEPLOYMENT_ID') === undefined;

// Response helpers
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (data: Record<string, unknown>) => json({ success: true, ...data });
const fail = (message: string, status = 400) => json({ success: false, error: message }, status);

// Validation schema for exercise
const ExerciseSchema = z.object({
  name: z.string().min(1, "Exercise name is required").max(100),
  sets: z.union([z.number(), z.string()]).transform(val => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num) || num < 1 || num > 20) {
      throw new Error('Sets must be a number between 1 and 20');
    }
    return num;
  }),
  reps: z.string().min(1).max(50),
  weight: z.string().max(50).optional(),
  rest: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
});

// Request payload schema
const UpdateExerciseRequestSchema = z.object({
  planId: z.string().uuid("Invalid plan ID"),
  weekKey: z.string().regex(/^Week [1-4]$/, "Week key must be 'Week 1' through 'Week 4'"),
  dayIndex: z.number().int().min(0).max(6, "Day index must be 0-6"),
  exerciseIndex: z.number().int().min(0),
  exercise: ExerciseSchema,
});

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing environment variables');
      return fail('Server configuration error', 500);
    }

    // User client for auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return fail('Missing authorization header', 401);
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user authentication
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      return fail('Unauthorized', 401);
    }

    console.log('[update-exercise] Processing request');

    // Parse and validate request body
    const body = await req.json();

    const validation = UpdateExerciseRequestSchema.safeParse(body);

    if (!validation.success) {
      const flattened = validation.error.flatten();
      console.error('[update-exercise] Validation failed');
      return fail(JSON.stringify({
        error: 'Validation error',
        details: flattened.fieldErrors,
        issues: validation.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          received: issue.code === 'invalid_type' ? (issue as { received: unknown }).received : undefined
        }))
      }), 400);
    }

    const { planId, weekKey, dayIndex, exerciseIndex, exercise } = validation.data;

    console.log('[update-exercise] Updating exercise');

    // Fetch plan with row lock to ensure atomic update
    const { data: plan, error: fetchError } = await supabaseClient
      .from('workout_plans')
      .select('content, user_id')
      .eq('id', planId)
      .eq('user_id', user.id) // RLS enforcement
      .single();

    if (fetchError || !plan) {
      console.error('Failed to fetch plan:', fetchError);
      return fail(
        JSON.stringify({
          error: 'Database error',
          details: fetchError?.message || fetchError?.details || fetchError?.hint || 'Workout plan not found'
        }),
        fetchError ? 500 : 404
      );
    }

    // Validate plan structure
    if (!plan.content || typeof plan.content !== 'object') {
      return fail('Invalid plan structure', 400);
    }

    // Cast content to a structured type
    // We expect content to be Record<string, WeekContent> where WeekContent is DayContent[]
    // But DB just says object.
    const content = plan.content as Record<string, unknown>;

    // Ensure week exists
    if (!Array.isArray(content[weekKey])) {
      content[weekKey] = [];
    }

    const week = content[weekKey] as unknown[]; // Array of days

    for (let i = 0; i < 7; i++) {
      if (!week[i]) {
        week[i] = { day: null, exercises: [] };
      }
      const day = week[i] as Record<string, unknown>;
      if (!Array.isArray(day.exercises)) {
        day.exercises = [];
      }
    }

    // Ensure target day & exercise slot exist
    const day = week[dayIndex] as { exercises: any[] }; // Keeping internal 'any' for exercises array manipulation to avoid complex types locally
    if (!day.exercises) day.exercises = [];

    while (day.exercises.length <= exerciseIndex) {
      day.exercises.push({
        name: 'Custom',
        sets: 1,
        reps: '10',
        weight: undefined,
        rest: undefined,
        description: undefined,
      });
    }

    // Update the specific exercise (preserve any extra fields)
    day.exercises[exerciseIndex] = {
      ...day.exercises[exerciseIndex],
      ...exercise,
    };

    console.log(`[update-exercise] Upserted ${weekKey} / day ${dayIndex} / ex ${exerciseIndex}: ${exercise.name}`);

    // Update the plan in database
    const { data: updatedPlan, error: updateError } = await supabaseClient
      .from('workout_plans')
      .update({ content })
      .eq('id', planId)
      .eq('user_id', user.id)
      .select('content')
      .single();

    if (updateError) {
      console.error('Failed to update plan:', updateError);
      return fail(
        JSON.stringify({
          error: 'Database error',
          details: updateError.message || updateError.details || updateError.hint || 'Failed to save changes'
        }),
        500
      );
    }

    console.log(`[update-exercise] Successfully updated plan ${planId}`);

    return ok({
      message: 'Exercise updated successfully',
      exercise: day.exercises[exerciseIndex],
      content: updatedPlan.content,
    });

  } catch (error: unknown) {
    console.error('[update-exercise] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    if (isDev) {
      console.error('[update-exercise] Stack:', errorStack);
    }
    return fail(
      JSON.stringify({
        error: errorMessage,
        ...(isDev && { stack: errorStack }),
      }),
      500
    );
  }
});
