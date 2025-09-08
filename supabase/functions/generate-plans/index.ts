import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ok = (obj: Record<string, any> = {}) => json({ success: true, ...obj }, 200);
const fail = (message: string, code?: string, extra?: Record<string, any>) =>
  json({ success: false, error: message, code, ...(extra || {}) }, 200);

function buildMockPlansDE(profile: { fitness_goal?: string; dietary_preference?: string }) {
  const goal = profile?.fitness_goal || 'Allgemeine Fitness';
  const diet = profile?.dietary_preference || 'Ausgewogen';
  
  // Structure to match what Dashboard expects
  const workout = {
    "Week 1": [
      { 
        day: 'Montag', 
        exercises: [
          { name: 'Kniebeugen', sets: '3', reps: '12', weight: 'Körpergewicht' },
          { name: 'Liegestütze', sets: '3', reps: '10', weight: 'Körpergewicht' },
          { name: 'Rudern', sets: '3', reps: '12', weight: 'Leicht' },
          { name: 'Plank', sets: '3', reps: '30s', weight: 'Körpergewicht' }
        ]
      },
      { 
        day: 'Dienstag', 
        exercises: [
          { name: 'Joggen', sets: '1', reps: '25-35 Min', weight: 'Cardio' },
          { name: 'Dehnen', sets: '1', reps: '10 Min', weight: 'Beweglichkeit' }
        ]
      },
      { 
        day: 'Mittwoch', 
        exercises: [
          { name: 'Schulterdrücken', sets: '3', reps: '12', weight: 'Leicht' },
          { name: 'Rudern', sets: '3', reps: '12', weight: 'Leicht' },
          { name: 'Core Training', sets: '3', reps: '15', weight: 'Körpergewicht' }
        ]
      },
      { 
        day: 'Donnerstag', 
        exercises: [
          { name: 'Spazieren', sets: '1', reps: '20-30 Min', weight: 'Erholung' },
          { name: 'Mobility', sets: '1', reps: '10 Min', weight: 'Beweglichkeit' }
        ]
      },
      { 
        day: 'Freitag', 
        exercises: [
          { name: 'Ausfallschritte', sets: '3', reps: '12 je Bein', weight: 'Körpergewicht' },
          { name: 'Glute Bridge', sets: '3', reps: '15', weight: 'Körpergewicht' },
          { name: 'Wadenheben', sets: '3', reps: '15', weight: 'Körpergewicht' }
        ]
      },
      { 
        day: 'Samstag', 
        exercises: [
          { name: 'Intervall Training', sets: '1', reps: '20-25 Min', weight: 'Cardio' }
        ]
      },
      { 
        day: 'Sonntag', 
        exercises: [
          { name: 'Ruhetag', sets: '1', reps: 'Optional: Spaziergang', weight: 'Erholung' }
        ]
      }
    ]
  };

  const nutrition = {
    "Frühstück": [
      { name: 'Haferflocken mit Joghurt', ingredients: 'Haferflocken, Joghurt, Beeren, Nüsse', calories: '~350 kcal' }
    ],
    "Mittag": [
      { name: 'Hähnchen mit Vollkornreis', ingredients: 'Hähnchen/Tofu, Vollkornreis, Gemüse', calories: '~450 kcal' }
    ],
    "Abend": [
      { name: 'Lachs mit Ofengemüse', ingredients: 'Lachs/Bohnen, Ofengemüse, Salat', calories: '~400 kcal' }
    ],
    "Snacks": [
      { name: 'Gesunde Snacks', ingredients: 'Quark/Skyr, Obst, Nüsse, Karotten mit Hummus', calories: '~150 kcal' }
    ]
  };

  return { workout, nutrition };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Health check endpoint
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    return ok({ health: 'ok' });
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

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    
    // Keep auth client for user verification
    const supabaseClient = createClient(
      SUPABASE_URL,
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
        return fail('Nicht autorisiert', 'AUTH');
      }

      // Check if current user is admin
      const { data: adminProfile, error: adminError } = await supabaseClient
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (adminError || !adminProfile?.is_admin) {
        console.error('Admin check failed:', adminError);
        return fail('Admin-Zugriff erforderlich', 'ADMIN_REQUIRED');
      }

      userId = targetUserId;
    } else {
      // Regular user generating their own plans
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      
      if (userError || !user) {
        console.error('Auth error:', userError);
        return fail('Nicht autorisiert', 'AUTH');
      }

      userId = user.id;
    }

    // Fetch user profile
    const { data: profile, error: profileError } = await sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Profile error:', profileError);
      return fail('Profil nicht gefunden. Bitte vervollständige dein Profil und versuche es erneut.', 'PROFILE_NOT_FOUND');
    }

    // Validate critical profile fields
    if (!profile.age || !profile.height || !profile.weight || !profile.fitness_goal || !profile.dietary_preference) {
      return fail('Bitte vervollständige dein Profil (Alter, Größe, Gewicht, Ziel/Diät) und versuche es erneut.', 'INCOMPLETE_PROFILE');
    }

    // Validate OpenAI API key
    if (!openAIApiKey) {
      console.error('OpenAI API key not found');
      return fail('Konfiguration des AI-Dienstes ungültig. Bitte Admin kontaktieren.', 'MISSING_API_KEY');
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
          response_format: { type: 'json_object' },
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
      return fail('Netzwerkfehler beim AI-Dienst. Bitte Internetverbindung prüfen und erneut versuchen.', 'NETWORK_ERROR');
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
          const mock = buildMockPlansDE(profile);
          // Delete existing plans for this user (to replace with new ones)
          await sb.from('workout_plans').delete().eq('user_id', userId);
          await sb.from('nutrition_plans').delete().eq('user_id', userId);
          
          // Save mock workout plan
          const { error: workoutError } = await sb
            .from('workout_plans')
            .insert({
              user_id: userId,
              content: mock.workout
            });

          // Save mock nutrition plan  
          const { error: nutritionError } = await sb
            .from('nutrition_plans')
            .insert({
              user_id: userId,
              content: mock.nutrition
            });

          if (workoutError || nutritionError) {
            return fail('Speichern der Pläne ist fehlgeschlagen. Bitte später erneut versuchen.', 'DB_SAVE');
          }
          
          return ok({ warning: 'mocked', source: 'fallback' });
        } else if (err.error?.code === 'invalid_api_key') {
          userMsg = 'Konfiguration des AI-Dienstes ungültig. Bitte Admin kontaktieren.';
          code = 'invalid_api_key';
        } else if (err.error?.code === 'rate_limit_exceeded' || response.status === 429) {
          const mock = buildMockPlansDE(profile);
          // Delete existing plans for this user (to replace with new ones)
          await sb.from('workout_plans').delete().eq('user_id', userId);
          await sb.from('nutrition_plans').delete().eq('user_id', userId);
          
          // Save mock workout plan
          const { error: workoutError } = await sb
            .from('workout_plans')
            .insert({
              user_id: userId,
              content: mock.workout
            });

          // Save mock nutrition plan  
          const { error: nutritionError } = await sb
            .from('nutrition_plans')
            .insert({
              user_id: userId,
              content: mock.nutrition
            });

          if (workoutError || nutritionError) {
            return fail('Speichern der Pläne ist fehlgeschlagen. Bitte später erneut versuchen.', 'DB_SAVE');
          }
          
          return ok({ warning: 'mocked', source: 'fallback' });
        }
      } catch (_) {}

      return fail(userMsg, code);
    }

    const data = await response.json();
    const generatedContent = data.choices[0].message.content;
    
    let parsedContent;
    try {
      parsedContent = JSON.parse(generatedContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      if (USE_MOCK_IF_OPENAI_FAILS) {
        const mock = buildMockPlansDE(profile);
        // Delete existing plans for this user (to replace with new ones)
        await sb.from('workout_plans').delete().eq('user_id', userId);
        await sb.from('nutrition_plans').delete().eq('user_id', userId);
        
        // Save mock workout plan
        const { error: workoutError } = await sb
          .from('workout_plans')
          .insert({
            user_id: userId,
            content: mock.workout
          });

        // Save mock nutrition plan  
        const { error: nutritionError } = await sb
          .from('nutrition_plans')
          .insert({
            user_id: userId,
            content: mock.nutrition
          });

        if (workoutError || nutritionError) {
          return fail('Speichern der Pläne ist fehlgeschlagen. Bitte später erneut versuchen.', 'DB_SAVE');
        }
        
        return ok({ warning: 'mocked', source: 'fallback' });
      }
      return fail('Antwort des KI-Dienstes war kein gültiges JSON. Bitte später erneut versuchen.', 'OPENAI_PARSE');
    }

    // Delete existing plans for this user (to replace with new ones)
    await sb.from('workout_plans').delete().eq('user_id', userId);
    await sb.from('nutrition_plans').delete().eq('user_id', userId);

    // Save workout plan
    const { error: workoutError } = await sb
      .from('workout_plans')
      .insert({
        user_id: userId,
        content: parsedContent.workoutPlan
      });

    if (workoutError) {
      console.error('Workout plan save error:', workoutError);
    }

    // Save nutrition plan
    const { error: nutritionError } = await sb
      .from('nutrition_plans')
      .insert({
        user_id: userId,
        content: parsedContent.nutritionPlan
      });

    if (nutritionError) {
      console.error('Nutrition plan save error:', nutritionError);
    }

    if (workoutError || nutritionError) {
      return fail('Speichern der Pläne ist fehlgeschlagen. Bitte später erneut versuchen.', 'DB_SAVE');
    }

    console.info(JSON.stringify({
      tag: "generate_plans_success",
      userId,
      ts: new Date().toISOString()
    }));

    return ok({ 
      workoutPlan: parsedContent.workoutPlan,
      nutritionPlan: parsedContent.nutritionPlan
    });

  } catch (error) {
    console.error(JSON.stringify({ 
      tag: "generate_plans_error", 
      message: error?.message, 
      name: error?.name,
      stack: error?.stack?.substring(0, 200)
    }));
    return fail('Unerwarteter Fehler beim Erstellen der Pläne. Bitte später erneut versuchen.', 'UNEXPECTED_ERROR');
  }
});