import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Response helpers
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (data: any) => json({ success: true, ...data });
const fail = (message: string, status = 400) => json({ success: false, error: message }, status);

// Validation schema for exercise
const ExerciseSchema = z.object({
  name: z.string().min(1, "Exercise name is required").max(100),
  sets: z.number().int().min(1).max(20),
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

    console.log(`[update-exercise] Request from user: ${user.id}`);

    // Parse and validate request body
    const body = await req.json();
    const validation = UpdateExerciseRequestSchema.safeParse(body);
    
    if (!validation.success) {
      console.error('Validation error:', validation.error.flatten());
      return fail(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`, 400);
    }

    const { planId, weekKey, dayIndex, exerciseIndex, exercise } = validation.data;

    console.log(`[update-exercise] Updating ${weekKey} day ${dayIndex} exercise ${exerciseIndex} in plan ${planId}`);

    // Fetch plan with row lock to ensure atomic update
    const { data: plan, error: fetchError } = await supabaseClient
      .from('workout_plans')
      .select('content, user_id')
      .eq('id', planId)
      .eq('user_id', user.id) // RLS enforcement
      .single();

    if (fetchError || !plan) {
      console.error('Failed to fetch plan:', fetchError);
      return fail('Workout plan not found', 404);
    }

    // Validate plan structure
    if (!plan.content || typeof plan.content !== 'object') {
      return fail('Invalid plan structure', 400);
    }

    const content = plan.content as Record<string, any>;

    // Validate week exists
    if (!content[weekKey] || !Array.isArray(content[weekKey])) {
      return fail(`Week ${weekKey} not found in plan`, 404);
    }

    const week = content[weekKey];

    // Validate day exists
    if (dayIndex < 0 || dayIndex >= week.length) {
      return fail(`Day index ${dayIndex} out of range`, 400);
    }

    const day = week[dayIndex];

    // Validate exercises array exists
    if (!day.exercises || !Array.isArray(day.exercises)) {
      return fail('Day has no exercises array', 400);
    }

    // Validate exercise index
    if (exerciseIndex < 0 || exerciseIndex >= day.exercises.length) {
      return fail(`Exercise index ${exerciseIndex} out of range`, 400);
    }

    // Update the specific exercise (preserve any extra fields)
    day.exercises[exerciseIndex] = {
      ...day.exercises[exerciseIndex],
      ...exercise,
    };

    console.log(`[update-exercise] Updated exercise: ${exercise.name}`);

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
      return fail('Failed to save changes', 500);
    }

    console.log(`[update-exercise] Successfully updated plan ${planId}`);

    return ok({
      message: 'Exercise updated successfully',
      exercise: day.exercises[exerciseIndex],
      content: updatedPlan.content,
    });

  } catch (error: any) {
    console.error('[update-exercise] Error:', error);
    return fail(error?.message || 'Internal server error', 500);
  }
});
