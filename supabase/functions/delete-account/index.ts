import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RequestSchema = z.object({
  action: z.enum(['request', 'confirm', 'cancel']),
  token: z.string().optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the user's JWT token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Nicht autorisiert' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Parse and validate request
    let body = { action: 'request' as const }; // Default action
    try {
      body = await req.json();
    } catch {
      // Use default if no body provided
    }

    const validation = RequestSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Ungültige Anfrage' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, token: confirmToken } = validation.data;

    // Handle different actions
    if (action === 'request') {
      // Check if deletion already requested
      const { data: existing } = await supabaseClient
        .from('deletion_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('cancelled', false)
        .single();

      if (existing) {
        return new Response(
          JSON.stringify({ 
            error: 'Löschung bereits angefordert',
            deletion_date: existing.deletion_date
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create deletion request with 14-day grace period
      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 14);
      
      const confirmationToken = crypto.randomUUID();

      const { error: insertError } = await supabaseClient
        .from('deletion_requests')
        .insert({
          user_id: userId,
          deletion_date: deletionDate.toISOString(),
          confirmation_token: confirmationToken
        });

      if (insertError) {
        console.error('[ERROR] Failed to create deletion request');
        return new Response(
          JSON.stringify({ error: 'Anfrage konnte nicht erstellt werden' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Löschung geplant',
          deletion_date: deletionDate.toISOString(),
          grace_period_days: 14
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'cancel') {
      const { error: cancelError } = await supabaseClient
        .from('deletion_requests')
        .update({ cancelled: true, cancelled_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('cancelled', false);

      if (cancelError) {
        console.error('[ERROR] Failed to cancel deletion');
        return new Response(
          JSON.stringify({ error: 'Abbruch fehlgeschlagen' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Löschung abgebrochen' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'confirm') {
      if (!confirmToken) {
        return new Response(
          JSON.stringify({ error: 'Bestätigungstoken erforderlich' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify token and check if deletion date has passed
      const { data: deletionReq, error: fetchError } = await supabaseClient
        .from('deletion_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('confirmation_token', confirmToken)
        .eq('cancelled', false)
        .single();

      if (fetchError || !deletionReq) {
        return new Response(
          JSON.stringify({ error: 'Ungültige Anfrage' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const deletionDate = new Date(deletionReq.deletion_date);
      const now = new Date();

      if (now < deletionDate) {
        return new Response(
          JSON.stringify({ 
            error: 'Wartezeit noch nicht abgelaufen',
            deletion_date: deletionDate.toISOString()
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Proceed with actual deletion
      await supabaseClient.from('workout_logs').delete().eq('user_id', userId);
      await supabaseClient.from('workout_plans').delete().eq('user_id', userId);
      await supabaseClient.from('nutrition_plans').delete().eq('user_id', userId);
      await supabaseClient.from('ai_feedback').delete().eq('user_id', userId);
      await supabaseClient.from('deletion_requests').delete().eq('user_id', userId);
      await supabaseClient.from('profiles').delete().eq('id', userId);
      
      const { error: authDeleteError } = await supabaseClient.auth.admin.deleteUser(userId);
      
      if (authDeleteError) {
        console.error('[ERROR] Failed to delete auth user');
        return new Response(
          JSON.stringify({ error: 'Kontolöschung fehlgeschlagen' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Konto erfolgreich gelöscht' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unbekannte Aktion' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ERROR] Unhandled exception:', error.message);
    
    return new Response(
      JSON.stringify({ error: 'Ein unerwarteter Fehler ist aufgetreten' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
