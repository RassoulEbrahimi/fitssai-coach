import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

// --- Types ---
interface QuoteResponse {
  quote: string;
  author: string;
  language: string;
  timestamp: string;
  source: 'openai' | 'zenquotes' | 'fallback';
}

interface ZenQuote {
  q: string; // quote
  a: string; // author
  h?: string;
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
const fail = (message: string, code: string, status = 400, details?: unknown) => 
  json({ success: false, error: message, code, details }, status);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // 1. Setup
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      return fail('Server config error', 'CONFIG_ERROR', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('Unauthorized', 'AUTH_MISSING', 401);

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 2. Auth Check
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return fail('Unauthorized', 'AUTH_INVALID', 401);
    }

    // 3. Logic
    // const { forceRefresh = false } = await req.json().catch(() => ({})); 
    // (Optional: Implement caching logic with forceRefresh later if needed)

    let quote = '';
    let author = '';
    let source: QuoteResponse['source'] = 'fallback';

    // A) Try OpenAI
    if (openAIApiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a fitness motivation expert. Generate inspiring, positive quotes about fitness, health, and personal growth. Keep quotes short and impactful.' },
              { role: 'user', content: 'Gib mir ein kurzes motivierendes Fitness-Zitat auf Deutsch. Gib nur den Zitat-Text ohne Anführungszeichen zurück.' }
            ],
            max_tokens: 100,
            temperature: 0.7,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) {
            quote = content.replace(/^["']|["']$/g, '');
            author = 'AI Coach';
            source = 'openai';
          }
        }
      } catch (e) {
        console.error('OpenAI failed:', e);
      }
    }

    // B) Fallback to ZenQuotes (if OpenAI failed)
    if (!quote) {
      try {
        const res = await fetch('https://zenquotes.io/api/today');
        if (res.ok) {
          const data = await res.json() as ZenQuote[];
          if (data && data[0]) {
            let rawQuote = data[0].q;
            author = data[0].a;
            
            // Translate if possible
            if (openAIApiKey) {
              try {
                const trRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${openAIApiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                      { role: 'system', content: 'Du bist ein professioneller Übersetzer.' },
                      { role: 'user', content: `Übersetze dieses Zitat ins Deutsche: "${rawQuote}"` }
                    ],
                    max_tokens: 150,
                  }),
                });
                if (trRes.ok) {
                  const trData = await trRes.json();
                  rawQuote = trData.choices[0].message.content.trim();
                }
              } catch (e) { console.error('Translation failed', e); }
            }
            
            quote = rawQuote;
            source = 'zenquotes';
          }
        }
      } catch (e) {
        console.error('ZenQuotes failed:', e);
      }
    }

    // C) Final Fallback
    if (!quote) {
      quote = 'Jeder Tag ist eine neue Gelegenheit, besser zu werden.';
      author = 'FitssAI';
      source = 'fallback';
    }

    return ok({
      quote,
      author,
      language: 'de',
      timestamp: new Date().toISOString(),
      source
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    // Even in error, try to return a quote so UI doesn't break
    return json({
      success: true, // Soft fail
      quote: 'Bleib stark, bleib fokussiert, bleib positiv!',
      author: 'FitssAI',
      language: 'de',
      source: 'fallback'
    });
  }
});