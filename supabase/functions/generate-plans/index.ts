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
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call OpenAI API
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      console.error('OpenAI API key not found');
      return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
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

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);

      let userMsg = 'Fehler beim Erstellen der Pläne. Bitte später erneut versuchen.';
      try {
        const err = JSON.parse(errorText);
        if (err.error?.code === 'insufficient_quota') {
          userMsg = 'AI-Dienst vorübergehend nicht verfügbar (Quota überschritten). Bitte später erneut versuchen.';
        }
      } catch (_) {}

      return new Response(JSON.stringify({ error: userMsg }), {
        status: 500,
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

    return new Response(JSON.stringify({ 
      success: true,
      workoutPlan: parsedContent.workoutPlan,
      nutritionPlan: parsedContent.nutritionPlan
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-plans function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});