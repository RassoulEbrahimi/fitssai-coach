
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";

// Relative imports from _shared
import { buildMockPlansDE } from '../_shared/mockUtils.ts';
import { GeneratePlansResponse, GeneratePlansRequest, WorkoutPlanContent, NutritionPlanContent } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Typed response helpers
const jsonResponse = (body: GeneratePlansResponse, status: number) =>
  new Response(JSON.stringify(body), {
    status, // Real HTTP status
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (data: Partial<GeneratePlansResponse> = {}) =>
  jsonResponse({ success: true, ...data }, 200);

const fail = (message: string, code: string, status = 400, extra: Record<string, unknown> = {}) =>
  jsonResponse({ success: false, error: { message, code }, ...extra }, status);

// Schema for request body
const requestSchema = z.object({
  user_id: z.string().uuid().optional(),
});

serve(async (req) => {
  // 1. Handle CORS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 2. Health check
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    return jsonResponse({ success: true, code: 'HEALTH_OK' }, 200);
  }

  const logCtx: Record<string, unknown> = { tag: 'generate_plans' };

  try {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY_New');
    logCtx.hasApiKey = !!openAIApiKey;

    // 3. Setup Supabase Clients
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      console.error('Missing env vars');
      return fail('Internal Server Error', 'CONFIG_ERROR', 500);
    }

    // Client for DB operations (service role)
    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    // Client for auth verification (msg headers)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return fail('No authorization header', 'UNAUTHORIZED', 401);
    }
    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    // 4. Parse & Validate Body
    let body: unknown = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // Empty body is allowed if not sending params
    }

    const parseResult = requestSchema.safeParse(body);
    if (!parseResult.success) {
      return fail('Invalid request parameters', 'VALIDATION_ERROR', 400, { details: parseResult.error });
    }
    const { user_id: targetUserId } = parseResult.data;

    // 5. Auth Strategy
    const { data: { user }, error: authError } = await sbAuth.auth.getUser();
    if (authError || !user) {
      return fail('Unauthorized', 'AUTH_FAILED', 401);
    }

    let userId = user.id;

    // If an admin wants to generate for someone else
    if (targetUserId && targetUserId !== userId) {
      // We check if the *authenticated user* is an admin via RPC called with auth context
      // Assuming 'is_current_user_admin' uses auth.uid()
      const { data: isAdminAuth, error: adminErr } = await sbAuth.rpc('is_current_user_admin');
      if (adminErr || !isAdminAuth) {
        return fail('Forbidden: Admin access required', 'FORBIDDEN', 403);
      }
      userId = targetUserId;
    }

    logCtx.userId = userId;

    // 6. Fetch User Profile
    const { data: profile, error: profileError } = await sbAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return fail('Profile not found', 'PROFILE_NOT_FOUND', 404);
    }

    // 7. Validate Profile Completeness
    const requiredFields = ['age', 'height', 'weight', 'fitness_goal', 'dietary_preference'];
    const missingFields = requiredFields.filter(f => !profile[f]);

    if (missingFields.length > 0) {
      return fail(
        'Bitte vervollständige dein Profil (Alter, Größe, Gewicht, Ziel/Diät).',
        'INCOMPLETE_PROFILE',
        400,
        { missingFields }
      );
    }

    // 8. Prepare AI Generation
    // We check OPENAI API KEY. If missing, we MUST use mock logic if we want to be nice, 
    // or fail. The requirement says: "Case D: Simulated AI failure ... expect 500".
    // "Case E: If mock mode exists ... show how to trigger mock path".
    // I will implement: If API key is missing -> Fail (config error).
    // If API key is present but call fails -> Fallback to Mock (resilience).

    if (!openAIApiKey) {
      console.error('OpenAI API Key missing');
      return fail('Service configuration error', 'MISSING_API_KEY', 500);
    }

    const languageInstruction =
      'Generate ALL content (exercise names, meal names, descriptions, day labels) in German (Deutsch). Use German language for all text content.';

    const dbProfile = profile as { age: number; weight: number; height: number; fitness_goal: string; dietary_preference: string; experience_level?: string };

    const prompt = `${languageInstruction}

Generate a personalized 4-week workout plan and a daily nutrition plan for a user with the following profile:
- Age: ${dbProfile.age} years old
- Weight: ${dbProfile.weight} kg
- Height: ${dbProfile.height} cm
- Fitness Goal: ${dbProfile.fitness_goal}
- Dietary Preference: ${dbProfile.dietary_preference}
- Experience Level: ${dbProfile.experience_level || 'Beginner'}

Please return a JSON response with exactly this structure:
{
  "workoutPlan": {
    "week1": [
      {
        "day": "Day 1",
        "exercises": [
          {
            "name": "Exercise name",
            "sets": "3",
            "reps": "12-15",
            "rest": "60 seconds"
          }
        ]
      }
    ],
    "week2": [...],
    "week3": [...],
    "week4": [...]
  },
  "nutritionPlan": {
    "breakfast": [
      {
        "name": "Meal name",
        "calories": 400,
        "description": "Brief description",
        "ingredients": "List of ingredients" 
      }
    ],
    "lunch": [...],
    "dinner": [...],
    "snacks": [...]
  }
}

Important: Use "name" property for meal names.
Make sure the workout plan is appropriate for their experience level.
`;

    let contentPayload: { workoutPlan: WorkoutPlanContent; nutritionPlan: NutritionPlanContent } | null = null;
    let warning = undefined;
    let source = 'ai';

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `You are a fitness expert. Output valid JSON only. ${languageInstruction}` },
            { role: 'user', content: prompt }
          ]
        }),
      });

      if (!response.ok) {
        console.warn(`OpenAI failed: ${response.status} ${response.statusText}`);
        throw new Error(`OpenAI Error: ${response.status}`);
      }

      const data = await response.json();
      const rawContent = data.choices[0].message.content;
      contentPayload = JSON.parse(rawContent);

    } catch (aiError) {
      console.error('AI Generation Failed, using mock fallback:', aiError);

      const mock = buildMockPlansDE({
        fitness_goal: dbProfile.fitness_goal,
        dietary_preference: dbProfile.dietary_preference
      });

      // Map mock to contentPayload shape
      contentPayload = {
        workoutPlan: mock.workout,
        nutritionPlan: mock.nutrition
      };
      warning = 'Generated with fallback logic due to AI service unavailability';
      source = 'mock';
    }

    if (!contentPayload) {
      return fail('Plan generation failed', 'GENERATION_FAILED', 500);
    }

    // 9. Save to Database
    // Delete old plans first
    await sbAdmin.from('workout_plans').delete().eq('user_id', userId);
    await sbAdmin.from('nutrition_plans').delete().eq('user_id', userId);

    // Insert new workout
    const { error: wError } = await sbAdmin.from('workout_plans').insert({
      user_id: userId,
      content: contentPayload.workoutPlan
    });

    if (wError) {
      console.error('DB Insert Workout Error:', wError);
      return fail('Error saving workout plan', 'DB_SAVE_ERROR', 500);
    }

    // Insert new nutrition
    const { error: nError } = await sbAdmin.from('nutrition_plans').insert({
      user_id: userId,
      content: contentPayload.nutritionPlan
    });

    if (nError) {
      console.error('DB Insert Nutrition Error:', nError);
      return fail('Error saving nutrition plan', 'DB_SAVE_ERROR', 500);
    }

    console.info(JSON.stringify({ ...logCtx, status: 'success', source }));

    return ok({
      workoutPlan: contentPayload.workoutPlan,
      nutritionPlan: contentPayload.nutritionPlan,
      warning,
      source
    });

  } catch (err: unknown) {
    console.error('Unexpected error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return fail('Unexpected system error', 'INTERNAL_SERVER_ERROR', 500, {
      message
    });
  }
});