import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

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
    // Verify user authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.log('Auth error:', authError?.message || 'No user found');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { language = 'de', forceRefresh = false } = await req.json();
    const finalLanguage = 'de'; // DE-only mode: Force German for all quotes
    
    console.log(`User ${user.id} fetching quote, forceRefresh: ${forceRefresh}`);

    let quote = '';
    let author = '';

    // Try OpenAI first
    if (openAIApiKey) {
      try {
        const prompt = 'Gib mir ein kurzes motivierendes Fitness-Zitat auf Deutsch. Gib nur den Zitat-Text ohne Anführungszeichen zurück.';

        console.log('Calling OpenAI API...');
        const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
                content: 'You are a fitness motivation expert. Generate inspiring, positive quotes about fitness, health, and personal growth. Keep quotes short and impactful.' 
              },
              { role: 'user', content: prompt }
            ],
            max_tokens: 100,
            temperature: 0.7,
          }),
        });

        if (openAIResponse.ok) {
          const openAIData = await openAIResponse.json();
          quote = openAIData.choices[0].message.content.trim();
          author = 'AI Generated';
          console.log('OpenAI quote generated successfully');
        } else {
          console.error('OpenAI API error:', await openAIResponse.text());
          throw new Error('OpenAI API failed');
        }
      } catch (error) {
        console.error('OpenAI error:', error);
        // Fall through to backup API
      }
    }

    // Fallback to ZenQuotes API if OpenAI failed or not available
    if (!quote) {
      console.log('Using fallback ZenQuotes API...');
      try {
        const zenResponse = await fetch('https://zenquotes.io/api/today');
        const zenData = await zenResponse.json();
        
        if (zenData && zenData[0]) {
          quote = zenData[0].q;
          author = zenData[0].a;

          // Translate to German if needed from English fallback
          if (openAIApiKey) {
            try {
              const translateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
                      content: 'Du bist ein professioneller Übersetzer. Übersetze das angegebene Zitat ins Deutsche und behalte dabei seine motivierende Wirkung und Bedeutung bei.' 
                    },
                    { role: 'user', content: `Übersetze dieses Zitat ins Deutsche: \"${quote}\"` }
                  ],
                  max_tokens: 150,
                  temperature: 0.3,
                }),
              });

              if (translateResponse.ok) {
                const translateData = await translateResponse.json();
                quote = translateData.choices[0].message.content.trim();
                console.log('Quote translated to German');
              }
            } catch (translateError) {
              console.error('Translation error:', translateError);
              // Keep original English quote if translation fails
            }
          }
        }
      } catch (error) {
        console.error('ZenQuotes API error:', error);
        // Final fallback - German quote
        quote = 'Jeder Tag ist eine neue Gelegenheit, besser zu werden.';
        author = 'FitssAI';
      }
    }

    return new Response(
      JSON.stringify({ 
        quote: quote.replace(/^[\"']|[\"']$/g, ''), // Remove quotes if present
        author,
        language: finalLanguage,
        timestamp: new Date().toISOString()
      }), 
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in get-daily-quote function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch quote',
        quote: 'Bleib stark, bleib fokussiert, bleib positiv!',
        author: 'FitssAI',
        language: 'de'
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
