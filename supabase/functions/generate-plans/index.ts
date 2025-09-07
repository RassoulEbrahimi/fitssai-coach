import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check endpoint
  const url = new URL(req.url);
  if (url.searchParams.get('health') === '1') {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    return new Response(JSON.stringify({ 
      ok: true, 
      env: { hasKey: Boolean(openAIApiKey) }, 
      msg: "generate-plans healthy" 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    // Log function entry
    console.info(JSON.stringify({
      tag: "generate_plans_begin",
      ts: new Date().toISOString(),
      hasApiKey: !!openAIApiKey,
      language: "de"
    }));

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Parse request body
    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // No body or invalid JSON, use empty object
    }
    const targetUserId = body.user_id;
    const language = 'de'; // DE-only mode: Force German for all AI outputs

    let userId: string;
    
    if (targetUserId) {
      // Admin is generating plans for another user
      // First verify that the current user is an admin
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      
      if (userError || !user) {
        console.error('Auth error:', userError);
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if current user is admin
      const { data: adminProfile, error: adminError } = await supabaseClient
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (adminError || !adminProfile?.is_admin) {
        console.error('Admin check failed:', adminError);
        return new Response(JSON.stringify({ error: 'Admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      userId = targetUserId;
    } else {
      // Regular user generating their own plans
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      
      if (userError || !user) {
        console.error('Auth error:', userError);
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      userId = user.id;
    }

    // Fetch user profile
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Profile error:', profileError);
      return new Response(JSON.stringify({ error: 'Profil nicht gefunden. Bitte vervollständige dein Profil und versuche es erneut.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate critical profile fields
    if (!profile.age || !profile.height || !profile.weight || !profile.fitness_goal || !profile.dietary_preference) {
      return new Response(JSON.stringify({ 
        error: 'Bitte vervollständige dein Profil (Alter, Größe, Gewicht, Ziel/Diät) und versuche es erneut.',
        code: 'incomplete_profile'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate OpenAI API key
    if (!openAIApiKey) {
      console.error('OpenAI API key not found');
      return new Response(JSON.stringify({ 
        error: 'Konfiguration des AI-Dienstes ungültig. Bitte Admin kontaktieren.',
        code: 'missing_api_key'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Language-specific instructions
    const languageInstruction = language === 'fa' 
      ? 'Generate ALL content (exercise names, meal names, descriptions, day labels) in Persian (Farsi). Use Persian/Farsi language for all text content.'
      : language === 'de' 
      ? 'Generate ALL content (exercise names, meal names, descriptions, day labels) in German (Deutsch). Use German language for all text content.'
      : 'Generate all content in English.';

    const prompt = `${languageInstruction}

Generate a personalized 4-week workout plan and a daily nutrition plan for a user with the following profile:
- Age: ${profile.age} years old
- Weight: ${profile.weight} kg
- Height: ${profile.height} cm
- Fitness Goal: ${profile.fitness_goal}
- Dietary Preference: ${profile.dietary_preference}
- Experience Level: ${profile.experience_level || 'Beginner'}

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
        "meal": "Meal name",
        "calories": 400,
        "description": "Brief description"
      }
    ],
    "lunch": [...],
    "dinner": [...],
    "snacks": [...]
  }
}

Make sure the workout plan is appropriate for their experience level and the nutrition plan matches their dietary preferences and fitness goals.

IMPORTANT: ${languageInstruction} All exercise names, meal names, descriptions, and any other text content must be in ${language === 'fa' ? 'Persian (Farsi)' : language === 'de' ? 'German (Deutsch)' : 'English'}.`;

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are a professional fitness and nutrition expert. Always respond with valid JSON only, no additional text. ${language === 'fa' ? 'Generate all content in Persian (Farsi) language.' : language === 'de' ? 'Generate all content in German (Deutsch) language.' : 'Generate all content in English.'}` 
            },
            { role: 'user', content: prompt }
          ],
        }),
      });
    } catch (error) {
      console.error(JSON.stringify({ 
        tag: "openai_fetch_error", 
        message: error?.message, 
        name: error?.name 
      }));
      return new Response(JSON.stringify({ 
        error: 'Netzwerkfehler beim AI-Dienst. Bitte Internetverbindung prüfen und erneut versuchen.',
        code: 'network_error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(JSON.stringify({ 
        tag: "openai_error", 
        status: response.status,
        statusText: response.statusText,
        errorText 
      }));

      let userMsg = 'Fehler beim Erstellen der Pläne. Bitte später erneut versuchen.';
      let code = 'api_error';
      let status = 500;

      try {
        const err = JSON.parse(errorText);
        if (err.error?.code === 'insufficient_quota') {
          userMsg = 'AI-Dienst vorübergehend nicht verfügbar (Quota überschritten). Bitte später erneut versuchen.';
          code = 'quota_exceeded';
        } else if (err.error?.code === 'invalid_api_key') {
          userMsg = 'Konfiguration des AI-Dienstes ungültig. Bitte Admin kontaktieren.';
          code = 'invalid_api_key';
        } else if (err.error?.code === 'rate_limit_exceeded' || response.status === 429) {
          userMsg = 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.';
          code = 'rate_limit';
          status = 429;
        }
      } catch (_) {}

      return new Response(JSON.stringify({ error: userMsg, code }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const generatedContent = data.choices[0].message.content;
    
    let parsedContent;
    try {
      parsedContent = JSON.parse(generatedContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      return new Response(JSON.stringify({ error: 'Invalid response format from AI' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete existing plans for this user (to replace with new ones)
    await supabaseClient.from('workout_plans').delete().eq('user_id', userId);
    await supabaseClient.from('nutrition_plans').delete().eq('user_id', userId);

    // Save workout plan
    const { error: workoutError } = await supabaseClient
      .from('workout_plans')
      .insert({
        user_id: userId,
        content: parsedContent.workoutPlan
      });

    if (workoutError) {
      console.error('Workout plan save error:', workoutError);
    }

    // Save nutrition plan
    const { error: nutritionError } = await supabaseClient
      .from('nutrition_plans')
      .insert({
        user_id: userId,
        content: parsedContent.nutritionPlan
      });

    if (nutritionError) {
      console.error('Nutrition plan save error:', nutritionError);
    }

    if (workoutError || nutritionError) {
      return new Response(JSON.stringify({ error: 'Failed to save plans' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.info(JSON.stringify({
      tag: "generate_plans_success",
      userId,
      ts: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ 
      ok: true,
      success: true,
      workoutPlan: parsedContent.workoutPlan,
      nutritionPlan: parsedContent.nutritionPlan
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ 
      tag: "generate_plans_error", 
      message: error?.message, 
      name: error?.name,
      stack: error?.stack?.substring(0, 200)
    }));
    return new Response(JSON.stringify({ 
      error: 'Unerwarteter Fehler beim Erstellen der Pläne. Bitte später erneut versuchen.',
      code: 'unexpected_error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});