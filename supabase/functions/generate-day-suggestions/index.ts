import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validation schema
const GenerateSuggestionsSchema = z.object({
  day_of_week: z.string().min(1).max(50, 'Day of week must be less than 50 characters'),
  available_time: z.number().int().min(5, 'Available time must be at least 5 minutes').max(300, 'Available time must be less than 300 minutes'),
  custom_prompt: z.string().max(1000, 'Custom prompt must be less than 1000 characters').optional(),
  focus_type: z.enum(['auto', 'strength', 'cardio', 'flexibility', 'mobility']).default('auto'),
});

// Sanitize custom prompt to prevent injection attacks
const sanitizePrompt = (prompt: string | undefined): string | undefined => {
  if (!prompt) return undefined;
  // Remove control characters and trim
  return prompt.replace(/[\x00-\x1F\x7F]/g, '').trim();
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY_New');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

    if (!openAIApiKey) {
      console.error('[ERROR] Missing OpenAI configuration');
      return new Response(
        JSON.stringify({ error: 'AI-Dienst nicht konfiguriert', code: 'OPENAI_KEY_MISSING' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[ERROR] Missing Supabase configuration');
      return new Response(
        JSON.stringify({ error: 'Server-Konfigurationsfehler', code: 'SUPABASE_CONFIG_MISSING' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create authenticated client
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Get current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error('[ERROR] Authentication failed');
      return new Response(
        JSON.stringify({ error: 'Nicht autorisiert', code: 'UNAUTHORIZED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validation = GenerateSuggestionsSchema.safeParse(body);

    if (!validation.success) {
      console.error('[ERROR] Input validation failed');
      return new Response(
        JSON.stringify({ error: 'Ungültige Eingabedaten', code: 'VALIDATION_ERROR' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { day_of_week, available_time, focus_type } = validation.data;
    const custom_prompt = sanitizePrompt(validation.data.custom_prompt);

    // Fetch user profile
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[ERROR] Profile fetch failed');
      return new Response(
        JSON.stringify({
          error: 'Profil nicht gefunden',
          code: 'PROFILE_NOT_FOUND'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch user feedback for adaptive prompting
    const { data: feedbackData } = await supabaseClient
      .from('ai_feedback')
      .select('reason, accepted')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    // Initialize feedback counts at function scope
    const feedbackCounts = {
      super: 0,
      hard: 0,
      light: 0,
      notstyle: 0
    };

    // Build AI prompt with optional adaptive adjustments
    let basePrompt = custom_prompt || `Generate 3-5 personalized workout exercises in German for:
- Day: ${day_of_week || 'Wochentag'}
- Fitness Goal: ${profile.fitness_goal}
- Experience Level: ${profile.experience_level || 'Beginner'}
- Available Time: ${available_time || 45} minutes
- Age: ${profile.age}, Weight: ${profile.weight}kg, Height: ${profile.height}cm

Make exercises specific, realistic, and suitable for their level. Include rest periods in duration.`;

    // ALWAYS append JSON format requirement, even for custom prompts
    let prompt = basePrompt + `\n\nReturn ONLY valid JSON in this EXACT format (no other text):
{
  "suggestions": [
    {
      "name": "Exercise name in German",
      "sets": 4,
      "reps": 8,
      "duration": 15,
      "description": "Brief reason why this exercise fits"
    }
  ]
}`;

    // Apply adaptive adjustments based on feedback if available
    if (feedbackData && feedbackData.length > 0 && !custom_prompt) {

      for (const item of feedbackData) {
        const reason = item.reason?.toLowerCase() || "";
        if (reason.includes("good") || reason === "good" || item.accepted) feedbackCounts.super++;
        if (reason.includes("hard") || reason === "hard") feedbackCounts.hard++;
        if (reason.includes("light") || reason === "light") feedbackCounts.light++;
        if (reason.includes("notstyle") || reason === "notstyle") feedbackCounts.notstyle++;
      }

      // Adjust prompt based on patterns
      if (feedbackCounts.hard > feedbackCounts.light * 1.5) {
        prompt += "\n\nWICHTIG: Der Nutzer fand vorherige Workouts oft zu anstrengend. Passe die Intensität leicht nach unten an, reduziere Gewichte um 10-15% und füge mehr Pausenzeit ein.";
      } else if (feedbackCounts.light > feedbackCounts.hard * 1.5) {
        prompt += "\n\nWICHTIG: Der Nutzer sucht mehr Herausforderung. Erhöhe die Intensität leicht, füge progressive Überlastung hinzu und reduziere Pausenzeiten.";
      }

      if (feedbackCounts.notstyle > 3 && feedbackCounts.notstyle > feedbackCounts.super) {
        prompt += "\n\nWICHTIG: Der Nutzer wünscht sich mehr Variation. Wechsle den Trainingsstil, probiere neue Übungsvarianten aus und bringe mehr Abwechslung rein.";
      }

      if (feedbackCounts.super > feedbackData.length * 0.7) {
        prompt += "\n\nHINWEIS: Der Nutzer ist sehr zufrieden mit dem aktuellen Stil. Behalte die aktuelle Intensität und Struktur bei.";
      }
    }

    // Apply focus_type adjustments
    switch (focus_type) {
      case 'cardio':
        prompt += "\n\nFOKUS: Cardio. Bevorzuge Ausdauer-/HIIT-/Intervall-Elemente. Geringe bis mittlere Last, höhere Herzfrequenz.";
        break;
      case 'kraft':
        prompt += "\n\nFOKUS: Kraft. Bevorzuge mehr Sätze/geringere Wdh., längere Pausen, progressive Überlastung.";
        break;
      case 'weniger':
        prompt += "\n\nFOKUS: Geringere Intensität. Leichtere Varianten, 10–15% weniger Last, längere Pausen, sichere Technik.";
        break;
      case 'mehr':
        prompt += "\n\nFOKUS: Höhere Intensität. Anspruchsvollere Varianten, kürzere Pausen, behalte Sicherheitshinweise.";
        break;
      case 'mobilitaet':
        prompt += "\n\nFOKUS: Mobilität/Beweglichkeit. Integriere Mobility- und Stretch-Blöcke (Aufwärmen+Cooldown).";
        break;
      case 'gelenk_knie':
        prompt += "\n\nFOKUS: Knie-schonend. Vermeide tiefe Kniebelastungen; nutze Alternativen (z. B. Step-ups, Hip Hinge, Box Squats).";
        break;
      case 'gelenk_hand':
        prompt += "\n\nFOKUS: Handgelenk-schonend. Vermeide stützlastige Übungen; nutze Fäuste/Griffe/Unterarme oder Maschinen-Alternativen.";
        break;
      default:
      // auto → no extra line
    }

    // Validate prompt before sending to OpenAI
    if (!prompt || prompt.trim().length < 10) {
      prompt = "Erstelle ein 30-minütiges Ganzkörper-Workout mit Fokus auf Kraft, Core und Ausdauer.";
    }

    // Start performance tracking
    const startTime = performance.now();
    let aiSuccess = false;
    let aiStatusCode = 0;
    let aiErrorMessage: string | null = null;

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
            {
              role: 'system',
              content: 'You are a professional fitness trainer. You MUST respond with valid JSON only in the exact format specified. Use German for all exercise names and descriptions. Never add explanatory text outside the JSON structure.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
        }),
      });

      aiStatusCode = response.status;
      aiSuccess = response.ok;

      if (!response.ok) {
        const errorText = await response.text();
        aiErrorMessage = errorText;

        // Handle rate limit / quota exhaustion specifically
        if (response.status === 429 || errorText.includes('insufficient_quota')) {
          console.error('[ERROR] OpenAI rate limit exceeded');
          return new Response(
            JSON.stringify({
              error: 'AI-Dienst überlastet oder Kontingent erschöpft.',
              code: 'RATE_LIMIT_OR_QUOTA_EXCEEDED'
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.error('[ERROR] OpenAI API request failed');
        return new Response(
          JSON.stringify({
            error: 'Fehler beim Generieren der Vorschläge',
            code: 'GENERATION_FAILED'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      const generatedContent = data.choices[0].message.content;

      let parsedContent;
      try {
        parsedContent = JSON.parse(generatedContent);
      } catch (parseError: any) {
        console.error('[ERROR] Failed to parse AI response');
        return new Response(
          JSON.stringify({
            error: 'KI-Antwort konnte nicht verarbeitet werden',
            code: 'GENERATION_FAILED'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate that we have actual suggestions
      if (!parsedContent || !parsedContent.suggestions || parsedContent.suggestions.length === 0) {
        console.error('[ERROR] No suggestions generated');
        return new Response(
          JSON.stringify({
            error: 'Keine Vorschläge erhalten',
            code: 'NO_SUGGESTIONS'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify(parsedContent),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (aiError: any) {
      aiSuccess = false;
      aiErrorMessage = aiError.message || aiError.toString();
      throw aiError;
    } finally {
      // Calculate latency
      const latency = Math.round(performance.now() - startTime);

      // Log AI request to database
      try {
        await supabaseClient.from('ai_logs').insert({
          user_id: user.id,
          model: 'gpt-4o-mini',
          latency_ms: latency,
          success: aiSuccess,
          status_code: aiStatusCode || null,
          error_message: aiErrorMessage
        });
      } catch (logError: unknown) {
        // Don't fail the request if logging fails
      }
    }

  } catch (error: unknown) {
    console.error('[ERROR] Unhandled exception:', error instanceof Error ? error.message : String(error));
    return new Response(
      JSON.stringify({
        error: 'Ein unerwarteter Fehler ist aufgetreten',
        code: 'INTERNAL_ERROR'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
