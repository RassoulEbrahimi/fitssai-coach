import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

// --- Types ---
interface UserProfile {
  id: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  fitness_goal: string | null;
  dietary_preference: string | null;
  created_at: string;
  full_name?: string | null;
}

interface UserRole {
  user_id: string;
  role: string;
}

interface Plan {
  id: string;
  user_id: string;
  content: unknown;
  created_at: string;
  type?: 'workout' | 'nutrition';
  user_email?: string;
}

interface AuthUser {
  id: string;
  email?: string;
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
const fail = (message: string, code: string, status = 400) => 
  json({ success: false, error: message, code }, status);

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  // Health check
  if (req.method === 'GET') return ok({ health: 'ok' });

  if (req.method !== 'POST') return fail('Ungültige Methode.', 'METHOD', 405);

  try {
    // 1. Setup Supabase Client (Service Role for Admin capabilities)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return fail('Server-Konfiguration fehlt.', 'CONFIG', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('Nicht angemeldet.', 'AUTH', 401);

    // Initialize client with Service Role but forward user auth context
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // 2. Auth Check (Authentication)
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) {
      return fail('Nicht angemeldet.', 'AUTH', 401);
    }

    // 3. Admin Check (Authorization)
    // We check against the DB function to ensure role validity
    const { data: isAdmin, error: rpcError } = await sb.rpc('is_current_user_admin');
    
    if (rpcError) {
      console.error('RPC Error:', rpcError);
      return fail('Profilprüfung fehlgeschlagen.', 'DB', 500);
    }
    
    if (!isAdmin) {
      return fail('Keine Berechtigung.', 'FORBIDDEN', 403);
    }

    // 4. Determine Action
    let action: 'users' | 'plans' | 'dashboard' = 'users'; // Default
    
    try {
      const body = await req.json();
      if (body?.action) action = body.action;
    } catch {
      // If JSON parse fails, check query params as fallback
      const url = new URL(req.url);
      const q = url.searchParams.get('action');
      if (q === 'users' || q === 'plans' || q === 'dashboard') {
        action = q as 'users' | 'plans' | 'dashboard';
      }
    }

    // 5. Execute Action
    
    // --- ACTION: USERS ---
    if (action === 'users') {
      // Fetch DB Profiles
      const { data: profiles, error: pErr } = await sb
        .from('profiles')
        .select('id, age, weight, height, fitness_goal, dietary_preference, created_at, full_name')
        .order('created_at', { ascending: false })
        .returns<UserProfile[]>();

      if (pErr) return fail('Benutzer konnten nicht geladen werden.', 'DB', 500);

      // Fetch Admin Roles
      const { data: roles, error: rErr } = await sb
        .from('user_roles')
        .select('user_id, role')
        .eq('role', 'admin')
        .returns<UserRole[]>();

      if (rErr) return fail('Rollen konnten nicht geladen werden.', 'DB', 500);

      const adminUserIds = new Set(roles?.map(r => r.user_id));

      // Fetch Auth Emails (Requires Service Role)
      const { data: authData, error: aErr } = await sb.auth.admin.listUsers();
      if (aErr) return fail('Benutzerliste konnte nicht geladen werden.', 'AUTH_ADMIN', 500);

      const authUsers = authData.users as AuthUser[];

      // Merge Data
      const users = (profiles || []).map(p => ({
        ...p,
        is_admin: adminUserIds.has(p.id),
        email: authUsers.find(u => u.id === p.id)?.email ?? 'N/A',
      }));

      return ok({ users });
    }

    // --- ACTION: PLANS ---
    if (action === 'plans') {
      const [workoutRes, nutritionRes, authRes] = await Promise.all([
        sb.from('workout_plans').select('id, user_id, content, created_at').order('created_at', { ascending: false }).returns<Plan[]>(),
        sb.from('nutrition_plans').select('id, user_id, content, created_at').order('created_at', { ascending: false }).returns<Plan[]>(),
        sb.auth.admin.listUsers()
      ]);

      if (workoutRes.error || nutritionRes.error || authRes.error) {
        return fail('Pläne konnten nicht geladen werden.', 'DB', 500);
      }

      const authUsers = authRes.data.users as AuthUser[];

      const plans = [
        ...(workoutRes.data || []).map(p => ({ ...p, type: 'workout' as const })),
        ...(nutritionRes.data || []).map(p => ({ ...p, type: 'nutrition' as const }))
      ].map(p => ({
        ...p,
        user_email: authUsers.find(u => u.id === p.user_id)?.email ?? 'N/A'
      })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return ok({ plans });
    }

    // --- ACTION: DASHBOARD ---
    if (action === 'dashboard') {
      const [profilesRes, rolesRes, workoutRes, nutritionRes, authRes] = await Promise.all([
        sb.from('profiles').select('id, created_at, full_name').order('created_at', { ascending: false }).returns<UserProfile[]>(),
        sb.from('user_roles').select('user_id, role').eq('role', 'admin').returns<UserRole[]>(),
        sb.from('workout_plans').select('id, user_id, created_at').returns<Plan[]>(),
        sb.from('nutrition_plans').select('id, user_id, created_at').returns<Plan[]>(),
        sb.auth.admin.listUsers()
      ]);

      if (profilesRes.error || rolesRes.error || workoutRes.error || nutritionRes.error || authRes.error) {
        return fail('Dashboard-Daten konnten nicht geladen werden.', 'DB', 500);
      }

      const adminUserIds = new Set(rolesRes.data?.map(r => r.user_id));
      const authUsers = authRes.data.users as AuthUser[];

      const users = (profilesRes.data || []).map(p => ({
        id: p.id,
        email: authUsers.find(u => u.id === p.id)?.email ?? 'N/A',
        full_name: p.full_name,
        role: adminUserIds.has(p.id) ? 'admin' : 'user',
        created_at: p.created_at,
      }));

      // Recent Activity Feed
      const activity = [
        ...(workoutRes.data || []).map(p => ({ ...p, type: 'workout' as const })),
        ...(nutritionRes.data || []).map(p => ({ ...p, type: 'nutrition' as const }))
      ].map(p => ({
        ...p,
        user_email: authUsers.find(u => u.id === p.user_id)?.email ?? 'N/A'
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);

      return ok({
        stats: {
          users: users.length,
          plans: (workoutRes.data?.length || 0) + (nutritionRes.data?.length || 0),
        },
        activity,
        users
      });
    }

    return fail('Unbekannte Aktion.', 'BAD_REQUEST');

  } catch (error) {
    console.error('Admin-fetch unexpected error:', error);
    return fail('Ein unerwarteter Fehler ist aufgetreten.', 'ERROR', 500);
  }
});