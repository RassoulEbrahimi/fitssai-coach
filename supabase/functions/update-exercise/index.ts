import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// --- Types ---
interface Exercise {
  name: string;
  sets: number;
  reps: string;
  weight?: string;
  rest?: string;
  description?: string;
  // Allow other properties to preserve data integrity if schema expands
  [key: string]: unknown;
}

interface DayContent {
  day: string | null;
  exercises: Exercise[];
}

type WeekContent = DayContent[];
type PlanContent = Record<string, WeekContent>;

// --- Configuration ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Response helpers
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (data: Record<string, unknown>) => json({ success: true, ...data });
const fail = (message: string, status = 400, details?: unknown) =>
  json({ success: false, error: message, details }, status);

// --- Validation Schemas ---
const ExerciseSchema = z.object({
  name: z.string().min(1, "Exercise name is required").max(100),
  sets: z.union([z.number(), z.string()]).transform((val: number | string) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num) || num < 1 || num > 30) { // Increased max sets slightly
      throw new Error('Sets must be a number between 1 and 30');
    }
    return num;
  }),
  reps: z.string().min(1).max(50),
  weight: z.string().max(50).optional(),
  rest: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
});

const UpdateExerciseRequestSchema = z.object({
  planId: z.string().uuid("Invalid plan ID"),
  weekKey: z.string().regex(/^Week [1-4]$/, "Week key must be 'Week 1' through 'Week 4'"),
  dayIndex: z.number().int().min(0).max(6, "Day index must be 0-6"),
  exerciseIndex: z.number().int().min(0),
  exercise: ExerciseSchema,
});

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // 1. Setup & Auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return fail('Server configuration error', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('Missing authorization header', 401);

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // SECURITY CHECK: Verify token validity
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return fail('Unauthorized', 401);
    }

    // 2. Parse & Validate Input
    const body = await req.json();
    const validation = UpdateExerciseRequestSchema.safeParse(body);

    if (!validation.success) {
      return fail('Validation error', 400, validation.error.flatten());
    }

    const { planId, weekKey, dayIndex, exerciseIndex, exercise } = validation.data;

    // 3. Fetch current plan (Securely scoped to user_id)
    const { data: plan, error: fetchError } = await supabaseClient
      .from('workout_plans')
      .select('content')
      .eq('id', planId)
      .eq('user_id', user.id) // Strict Ownership Check
      .single();

    if (fetchError || !plan) {
      return fail('Workout plan not found or access denied', 404);
    }

    // 4. Update Logic with Strict Typing
    // Safe casting using the interfaces defined above
    const content = (plan.content || {}) as PlanContent;

    // Ensure structure exists
    if (!Array.isArray(content[weekKey])) {
      content[weekKey] = [];
    }

    const week = content[weekKey];

    // Ensure day exists
    if (!week[dayIndex]) {
      // Fill gaps if necessary
      for (let i = 0; i <= dayIndex; i++) {
        if (!week[i]) week[i] = { day: null, exercises: [] };
      }
    }

    const day = week[dayIndex];
    if (!Array.isArray(day.exercises)) {
      day.exercises = [];
    }

    // Ensure exercise slot exists (fill gaps with placeholders if adding new index)
    while (day.exercises.length <= exerciseIndex) {
      day.exercises.push({
        name: 'New Exercise',
        sets: 3,
        reps: '10',
        weight: '',
        rest: '',
        description: ''
      });
    }

    // Apply update
    day.exercises[exerciseIndex] = {
      ...day.exercises[exerciseIndex], // Keep existing props
      ...exercise,                     // Overwrite with new data
    };

    // 5. Save changes
    const { data: updatedPlan, error: updateError } = await supabaseClient
      .from('workout_plans')
      .update({ content })
      .eq('id', planId)
      .eq('user_id', user.id)
      .select('content')
      .single();

    if (updateError) {
      console.error('Update failed:', updateError);
      return fail('Failed to save changes', 500);
    }

    return ok({
      message: 'Exercise updated',
      exercise: day.exercises[exerciseIndex],
      // Optional: return full content only if needed, to save bandwidth
      // content: updatedPlan.content 
    });

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return fail('Internal server error', 500);
  }
});