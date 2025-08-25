import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { language = 'en', forceRefresh = false } = await req.json();
    
    console.log(`Fetching quote for language: ${language}, forceRefresh: ${forceRefresh}`);

    let quote = '';
    let author = '';

    // Try OpenAI first
    if (openAIApiKey) {
      try {
        const prompt = language === 'fa' 
          ? 'Give me one short motivational fitness quote in Persian (Farsi). Return only the quote text without quotation marks.'
          : 'Give me one short motivational fitness quote. Return only the quote text without quotation marks.';

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

          // Translate to Persian if needed
          if (language === 'fa' && openAIApiKey) {
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
                      content: 'You are a professional translator. Translate the given quote to Persian (Farsi) while maintaining its motivational impact and meaning.' 
                    },
                    { role: 'user', content: `Translate this quote to Persian: \"${quote}\"` }
                  ],
                  max_tokens: 150,
                  temperature: 0.3,
                }),
              });

              if (translateResponse.ok) {
                const translateData = await translateResponse.json();
                quote = translateData.choices[0].message.content.trim();
                console.log('Quote translated to Persian');
              }
            } catch (translateError) {
              console.error('Translation error:', translateError);
              // Keep original English quote if translation fails
            }
          }
        }
      } catch (error) {
        console.error('ZenQuotes API error:', error);
        // Final fallback
        quote = language === 'fa' 
          ? 'هر روز فرصتی جدید برای بهتر شدن است.'
          : 'Every day is a new opportunity to become better.';
        author = 'FitssAI';
      }
    }

    return new Response(
      JSON.stringify({ 
        quote: quote.replace(/^[\"']|[\"']$/g, ''), // Remove quotes if present
        author,
        language,
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
        quote: 'Stay strong, stay focused, stay positive!',
        author: 'FitssAI',
        language: 'en'
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
