import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// --- Types ---
interface AIParsedResponse {
  suggestions: Array<{
    name: string;
    sets: number | string;
    reps: number | string;
    duration: number | string;
    description: string;
  }>;
}

// --- Helpers ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (data: Record<string, unknown>) => json({ success: true, ...data });
const fail = (message: string, code: string, status = 400) =>
  json({ success: false, error: message, code }, status);

// --- Validation ---
const GenerateSuggestionsSchema = z.object({
  day_of_week: z.string().min(1).max(50),
  available_time: z.number().int().min(5).max(300),
  custom_prompt: z.string().max(1000).optional(),
  focus_type: z.enum(['auto', 'strength', 'cardio', 'flexibility', 'mobility', 'kraft', 'weniger', 'mehr', 'gelenk_knie', 'gelenk_hand']).default('auto'),
});

const sanitizePrompt = (prompt: string | undefined): string | undefined => {
  if (!prompt) return undefined;
  // eslint-disable-next-line no-control-regex
  return prompt.replace(/[\x00-\x1F\x7F]/g, '').trim();
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // 1. Setup
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY_New'); // Keeping your specific var name
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!openAIApiKey) return fail('AI-Dienst nicht konfiguriert', 'OPENAI_KEY_MISSING', 500);
    if (!supabaseUrl || !supabaseAnonKey) return fail('Server-Konfigurationsfehler', 'CONFIG_MISSING', 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('Nicht autorisiert', 'UNAUTHORIZED', 401);

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 2. Auth Check
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) return fail('Nicht autorisiert', 'UNAUTHORIZED', 401);

    // 3. Validation
    const body = await req.json();
    const validation = GenerateSuggestionsSchema.safeParse(body);

    if (!validation.success) {
      return fail('Ungültige Eingabedaten', 'VALIDATION_ERROR', 400);
    }

    const { day_of_week, available_time, focus_type } = validation.data;
    const custom_prompt = sanitizePrompt(validation.data.custom_prompt);

    // 4. Fetch Context (Profile & Feedback)
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) return fail('Profil nicht gefunden', 'PROFILE_NOT_FOUND', 404);

    const { data: feedbackData } = await supabaseClient
      .from('ai_feedback')
      .select('reason, accepted')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    // 5. Build Prompt
    const feedbackCounts = { super: 0, hard: 0, light: 0, notstyle: 0 };

    // Analyze feedback
    if (feedbackData && feedbackData.length > 0 && !custom_prompt) {
      for (const item of feedbackData) {
        const reason = (item.reason || "").toLowerCase();
        if (reason.includes("good") || reason === "good" || item.accepted) feedbackCounts.super++;
        if (reason.includes("hard") || reason === "hard") feedbackCounts.hard++;
        if (reason.includes("light") || reason === "light") feedbackCounts.light++;
        if (reason.includes("notstyle") || reason === "notstyle") feedbackCounts.notstyle++;
      }
    }

    const basePrompt = custom_prompt || `Generate 3-5 personalized workout exercises in German for:
- Day: ${day_of_week}
- Goal: ${profile.fitness_goal}
- Level: ${profile.experience_level || 'Beginner'}
- Time: ${available_time} min
- Stats: ${profile.age}y, ${profile.weight}kg, ${profile.height}cm`;

    let prompt = basePrompt + `\n\nReturn ONLY valid JSON in this EXACT format:
{
  "suggestions": [
    {
      "name": "Exercise name in German",
      "sets": 4,
      "reps": 8,
      "duration": 15,
      "description": "Brief reason"
    }
  ]
}`;

    // Adaptive Logic
    if (!custom_prompt) {
      if (feedbackCounts.hard > feedbackCounts.light * 1.5) prompt += "\n\nADJUST: Less intensity, -10% weights, more rest.";
      else if (feedbackCounts.light > feedbackCounts.hard * 1.5) prompt += "\n\nADJUST: More intensity, progressive overload.";

      if (feedbackCounts.notstyle > 3 && feedbackCounts.notstyle > feedbackCounts.super) prompt += "\n\nADJUST: Change training style, more variety.";
    }

    // Focus Logic
    const focusMap: Record<string, string> = {
      'cardio': "\n\nFOKUS: Cardio/HIIT. High heart rate.",
      'kraft': "\n\nFOKUS: Strength. Low reps, high load.",
      'weniger': "\n\nFOKUS: Low intensity. Safety first.",
      'mehr': "\n\nFOKUS: High intensity. Push limits.",
      'mobilitaet': "\n\nFOKUS: Mobility & Stretching.",
      'gelenk_knie': "\n\nFOKUS: Knee-friendly. No deep squats/jumps.",
      'gelenk_hand': "\n\nFOKUS: Wrist-friendly. No heavy support on hands.",
    };
    if (focusMap[focus_type]) prompt += focusMap[focus_type];

    if (!prompt || prompt.trim().length < 10) prompt = "Erstelle ein 30-minütiges Ganzkörper-Workout.";

    // 6. Call OpenAI
    const startTime = performance.now();
    let aiSuccess = false;
    let aiStatusCode = 0;
    let aiErrorMessage: string | null = null;
    let suggestions = [];

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
            { role: 'system', content: 'You are a fitness trainer. Respond with valid JSON only. German language.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
        }),
      });

      aiStatusCode = response.status;
      aiSuccess = response.ok;

      if (!response.ok) {
        const errText = await response.text();
        aiErrorMessage = errText;
        if (response.status === 429) return fail('AI-Dienst überlastet', 'RATE_LIMIT', 429);
        throw new Error(`OpenAI Error: ${errText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) throw new Error('Empty response from AI');

      const parsed = JSON.parse(content) as AIParsedResponse;
      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        throw new Error('Invalid JSON structure');
      }
      suggestions = parsed.suggestions;

    } catch (err) {
      aiErrorMessage = err instanceof Error ? err.message : String(err);
      console.error('AI Error:', aiErrorMessage);
      return fail('Fehler beim Generieren', 'GENERATION_FAILED', 500);
    } finally {
      // 7. Log to DB
      const latency = Math.round(performance.now() - startTime);
      await supabaseClient.from('ai_logs').insert({
        user_id: user.id,
        model: 'gpt-4o-mini',
        latency_ms: latency,
        success: aiSuccess,
        status_code: aiStatusCode,
        error_message: aiErrorMessage
      });
    }

    return ok({ suggestions });

  } catch (error) {
    console.error('Unhandled:', error);
    return fail('Interner Serverfehler', 'INTERNAL_ERROR', 500);
  }
});