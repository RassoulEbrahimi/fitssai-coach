import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Log environment variable presence
    console.log('[Diagnostics] Using OpenAI key variable: OPENAI_API_KEY_New');
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY_New');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    
    console.log('[Diagnostics] Environment check:', {
      hasOpenAIKey: !!openAIApiKey,
      hasSupabaseURL: !!SUPABASE_URL,
      hasSupabaseAnonKey: !!SUPABASE_ANON_KEY
    });

    if (!openAIApiKey) {
      console.error('[Error] OpenAI API key not found in environment');
      return new Response(
        JSON.stringify({ error: 'AI-Dienst nicht konfiguriert', code: 'OPENAI_KEY_MISSING' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[Error] Missing Supabase configuration');
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
    
    console.log('[Diagnostics] Auth check:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      authError: userError?.message
    });

    if (userError || !user) {
      console.error('[Error] Auth failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Nicht autorisiert', code: 'UNAUTHORIZED', details: userError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { day_of_week, available_time, custom_prompt } = await req.json();
    
    console.log('[Diagnostics] Request body:', {
      day_of_week,
      available_time,
      userId: user.id,
      hasCustomPrompt: !!custom_prompt
    });

    // Fetch user profile
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    console.log('[Diagnostics] Profile fetch result:', {
      hasProfile: !!profile,
      profileError: profileError?.message,
      profileData: profile ? {
        fitness_goal: profile.fitness_goal,
        experience_level: profile.experience_level,
        age: profile.age,
        weight: profile.weight,
        height: profile.height
      } : null
    });

    if (profileError || !profile) {
      console.error('[Error] Profile not found:', profileError);
      return new Response(
        JSON.stringify({ 
          error: 'Profil nicht gefunden', 
          code: 'PROFILE_NOT_FOUND',
          details: profileError?.message 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Info] Generating suggestions for:', { 
      userId: user.id, 
      day: day_of_week, 
      goal: profile.fitness_goal,
      experience: profile.experience_level 
    });

    // Fetch user feedback for adaptive prompting
    const { data: feedbackData } = await supabaseClient
      .from('ai_feedback')
      .select('reason, accepted')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    console.log('[Info] Feedback data retrieved:', {
      feedbackCount: feedbackData?.length || 0
    });

    // Build AI prompt with optional adaptive adjustments
    let prompt = custom_prompt || `Generate 3-5 personalized workout exercises in German for:
- Day: ${day_of_week || 'Wochentag'}
- Fitness Goal: ${profile.fitness_goal}
- Experience Level: ${profile.experience_level || 'Beginner'}
- Available Time: ${available_time || 45} minutes
- Age: ${profile.age}, Weight: ${profile.weight}kg, Height: ${profile.height}cm

Return ONLY valid JSON in this exact format:
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
}

Make exercises specific, realistic, and suitable for their level. Include rest periods in duration.`;

    // Apply adaptive adjustments based on feedback if available
    if (feedbackData && feedbackData.length > 0 && !custom_prompt) {
      const feedbackCounts = {
        super: 0,
        hard: 0,
        light: 0,
        notstyle: 0
      };

      for (const item of feedbackData) {
        const reason = item.reason?.toLowerCase() || "";
        if (reason.includes("good") || reason === "good" || item.accepted) feedbackCounts.super++;
        if (reason.includes("hard") || reason === "hard") feedbackCounts.hard++;
        if (reason.includes("light") || reason === "light") feedbackCounts.light++;
        if (reason.includes("notstyle") || reason === "notstyle") feedbackCounts.notstyle++;
      }

      console.log('[Info] Feedback analysis:', feedbackCounts);

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

    // 🔒 Validate prompt before sending to OpenAI
    if (!prompt || prompt.trim().length < 10) {
      console.warn("[generate-day-suggestions] Empty prompt detected. Using fallback prompt.");
      prompt = "Erstelle ein 30-minütiges Ganzkörper-Workout mit Fokus auf Kraft, Core und Ausdauer.";
    }

    console.log('[Info] Calling OpenAI API with model: gpt-4o-mini');
    console.log('[Info] Prompt length:', prompt.length);

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
            content: 'You are a professional fitness trainer. Always respond with valid JSON only. Use German for all exercise names and descriptions.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
      }),
    });

      console.log('[Diagnostics] OpenAI response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      aiStatusCode = response.status;
      aiSuccess = response.ok;

      if (!response.ok) {
        const errorText = await response.text();
        aiErrorMessage = errorText;
        
        // Handle rate limit / quota exhaustion specifically
        if (response.status === 429 || errorText.includes('insufficient_quota')) {
          console.error('[OpenAI 429 Error] Rate or Quota exceeded:', {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          });
          return new Response(
            JSON.stringify({
              error: 'AI-Dienst überlastet oder Kontingent erschöpft.',
              code: 'RATE_LIMIT_OR_QUOTA_EXCEEDED',
              details: 'OpenAI hat den Zugriff vorübergehend eingeschränkt. Bitte später erneut versuchen.'
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.error('[Error] OpenAI API error:', {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText
        });
        return new Response(
          JSON.stringify({ 
            error: 'Fehler beim Generieren der Vorschläge', 
            code: 'GENERATION_FAILED', 
            details: `OpenAI API returned ${response.status}: ${errorText}` 
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
    console.log('[Diagnostics] OpenAI raw response data:', {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      hasContent: !!data.choices?.[0]?.message?.content
    });

    const generatedContent = data.choices[0].message.content;
    console.log('[Diagnostics] Generated content (first 200 chars):', generatedContent?.substring(0, 200));

    let parsedContent;
    try {
      parsedContent = JSON.parse(generatedContent);
      console.log('[Info] Successfully parsed AI response:', {
        hasSuggestions: !!parsedContent.suggestions,
        suggestionsCount: parsedContent.suggestions?.length
      });
    } catch (parseError: any) {
      console.error('[Error] Failed to parse OpenAI JSON response:', {
        error: parseError.message,
        content: generatedContent
      });
      return new Response(
        JSON.stringify({ 
          error: 'KI-Antwort konnte nicht verarbeitet werden', 
          code: 'GENERATION_FAILED',
          details: `JSON parse error: ${parseError.message}` 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

      // ✅ Validate that we have actual suggestions
      if (!parsedContent || !parsedContent.suggestions || parsedContent.suggestions.length === 0) {
        console.error('[generate-day-suggestions] No suggestions returned from AI.');
        return new Response(
          JSON.stringify({
            error: 'Keine Vorschläge erhalten',
            code: 'NO_SUGGESTIONS',
            details: 'AI konnte keine Vorschläge generieren. Bitte erneut versuchen oder Eingaben prüfen.',
            promptUsed: prompt.substring(0, 200),
            feedbackSummary: feedbackCounts
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
        console.log(`[AI Log] Logged request: success=${aiSuccess}, latency=${latency}ms, status=${aiStatusCode}`);
      } catch (logError: any) {
        console.error('[Error] Failed to log AI request:', logError.message);
        // Don't fail the request if logging fails
      }
    }

  } catch (error: any) {
    console.error('[Error] Unhandled exception in generate-day-suggestions:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Unerwarteter Fehler',
        code: 'INTERNAL_ERROR',
        details: error.stack || error.toString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
