import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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
const fail = (message: string, status = 400, details?: unknown) => 
  json({ success: false, error: message, details }, status);

// --- Validation ---
const RequestSchema = z.object({
  action: z.enum(['request', 'confirm', 'cancel']),
  token: z.string().optional(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // 1. Init Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing env vars');
      return fail('Server configuration error', 500);
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 2. Auth Check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('Nicht autorisiert', 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return fail('Nicht autorisiert', 401);
    }

    const userId = user.id;

    // 3. Parse Body
    let body;
    try {
      body = await req.json();
    } catch {
      body = { action: 'request' };
    }

    const validation = RequestSchema.safeParse(body);
    if (!validation.success) {
      return fail('Ungültige Anfrage', 400, validation.error.flatten());
    }

    const { action, token: confirmToken } = validation.data;

    // 4. Handle Actions
    
    // --- REQUEST DELETION ---
    if (action === 'request') {
      const { data: existing } = await supabaseClient
        .from('deletion_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('cancelled', false)
        .single();

      if (existing) {
        return fail('Löschung bereits angefordert', 400, { deletion_date: existing.deletion_date });
      }

      // 14-day grace period
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
        console.error('Insert Error:', insertError);
        return fail('Anfrage konnte nicht erstellt werden', 500);
      }

      return ok({
        message: 'Löschung geplant',
        deletion_date: deletionDate.toISOString(),
        grace_period_days: 14
      });
    }

    // --- CANCEL DELETION ---
    if (action === 'cancel') {
      const { error: cancelError } = await supabaseClient
        .from('deletion_requests')
        .update({ cancelled: true, cancelled_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('cancelled', false);

      if (cancelError) {
        return fail('Abbruch fehlgeschlagen', 500);
      }

      return ok({ message: 'Löschung abgebrochen' });
    }

    // --- CONFIRM DELETION ---
    if (action === 'confirm') {
      if (!confirmToken) return fail('Bestätigungstoken erforderlich');

      const { data: deletionReq, error: fetchError } = await supabaseClient
        .from('deletion_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('confirmation_token', confirmToken)
        .eq('cancelled', false)
        .single();

      if (fetchError || !deletionReq) {
        return fail('Ungültige Anfrage');
      }

      const deletionDate = new Date(deletionReq.deletion_date);
      const now = new Date();

      if (now < deletionDate) {
        return fail('Wartezeit noch nicht abgelaufen', 400, { deletion_date: deletionDate.toISOString() });
      }

      // THE MAGIC MOMENT: Cascading delete via Admin API
      const { error: authDeleteError } = await supabaseClient.auth.admin.deleteUser(userId);

      if (authDeleteError) {
        console.error('Delete User Error:', authDeleteError);
        return fail('Kontolöschung fehlgeschlagen', 500);
      }

      return ok({ message: 'Konto erfolgreich gelöscht' });
    }

    return fail('Unbekannte Aktion');

  } catch (error) {
    console.error('Unhandled:', error);
    return fail('Ein unerwarteter Fehler ist aufgetreten', 500);
  }
});