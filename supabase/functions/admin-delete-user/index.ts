import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

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
const fail = (message: string, code: string, status = 400) => 
  json({ success: false, error: message, code }, status);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  if (req.method === 'GET') {
    return ok({ health: 'ok' });
  }

  if (req.method !== 'POST') {
    return fail('Ungültige Methode.', 'METHOD', 405);
  }

  try {
    // 1. Setup Supabase Client with Service Role
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return fail('Server-Konfiguration fehlt.', 'CONFIG', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return fail('Nicht angemeldet.', 'AUTH', 401);
    }

    // Initialize client with Service Role
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // 2. Verify the requesting user is authenticated
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return fail('Nicht angemeldet.', 'AUTH', 401);
    }

    // 3. Verify the requesting user is an admin
    const { data: isAdmin, error: rpcError } = await sb.rpc('is_current_user_admin');
    
    if (rpcError) {
      console.error('RPC Error checking admin status:', rpcError);
      return fail('Admin-Prüfung fehlgeschlagen.', 'DB', 500);
    }
    
    if (!isAdmin) {
      console.warn(`Non-admin user ${user.id} attempted to delete a user`);
      return fail('Keine Berechtigung.', 'FORBIDDEN', 403);
    }

    // 4. Parse request body to get userId to delete
    let userId: string;
    try {
      const body = await req.json();
      userId = body?.userId;
    } catch {
      return fail('Ungültige Anfrage.', 'BAD_REQUEST', 400);
    }

    if (!userId || typeof userId !== 'string') {
      return fail('Benutzer-ID fehlt.', 'BAD_REQUEST', 400);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return fail('Ungültige Benutzer-ID.', 'BAD_REQUEST', 400);
    }

    // 5. Prevent self-deletion
    if (userId === user.id) {
      return fail('Sie können sich nicht selbst löschen.', 'FORBIDDEN', 403);
    }

    console.log(`Admin ${user.id} deleting user ${userId}`);

    // 6. Delete the user using admin API (this cascades to profiles via foreign key)
    const { error: deleteError } = await sb.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('Error deleting user:', deleteError);
      return fail('Benutzer konnte nicht gelöscht werden.', 'DELETE_FAILED', 500);
    }

    console.log(`Successfully deleted user ${userId}`);

    return ok({ 
      message: 'Benutzer erfolgreich gelöscht.',
      deletedUserId: userId 
    });

  } catch (error) {
    console.error('Unexpected error in admin-delete-user:', error);
    return fail('Ein unerwarteter Fehler ist aufgetreten.', 'ERROR', 500);
  }
});
