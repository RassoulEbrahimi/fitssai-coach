import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 0) Config sanity
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ success: false, error: "Server-Konfiguration fehlt (URL/SERVICE_ROLE_KEY).", code: "CONFIG" });
  }

  try {
    // 1) Single Supabase client — Service Role for DB/admin; forward end-user token for auth.getUser()
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    // 2) AuthN — current user
    const { data: { user }, error: userErr } = await sb.auth.getUser();
    if (userErr || !user) return json({ success: false, error: "Nicht angemeldet.", code: "AUTH" });

    // 3) AuthZ — must be admin
    const { data: profile, error: profErr } = await sb
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (profErr) return json({ success: false, error: "Profilprüfung fehlgeschlagen.", code: "DB" });
    if (!profile?.is_admin) return json({ success: false, error: "Keine Berechtigung.", code: "FORBIDDEN" });

    // 4) Body parsing (robust)
    let action: "users" | "plans";
    try {
      const body = await req.json();
      action = body?.action;
    } catch {
      return json({ success: false, error: "Ungültige Anfrage.", code: "BAD_REQUEST" });
    }

    // 5) Actions
    if (action === "users") {
      const { data: profilesData, error: pErr } = await sb
        .from("profiles")
        .select("id, age, weight, height, fitness_goal, dietary_preference, is_admin, created_at")
        .order("created_at", { ascending: false });
      if (pErr) return json({ success: false, error: "Benutzer konnten nicht geladen werden.", code: "DB" });

      const { data: authUsers, error: aErr } = await sb.auth.admin.listUsers();
      if (aErr) return json({ success: false, error: "Benutzer konnten nicht geladen werden.", code: "AUTH_ADMIN" });

      const users = (profilesData || []).map((p: any) => ({
        ...p,
        email: authUsers.users.find((u: any) => u.id === p.id)?.email ?? "N/A",
      }));
      return json({ success: true, users });
    }

    if (action === "plans") {
      const { data: workout, error: wErr } = await sb
        .from("workout_plans")
        .select("id, user_id, content, created_at")
        .order("created_at", { ascending: false });
      if (wErr) return json({ success: false, error: "Pläne konnten nicht geladen werden.", code: "DB" });

      const { data: nutrition, error: nErr } = await sb
        .from("nutrition_plans")
        .select("id, user_id, content, created_at")
        .order("created_at", { ascending: false });
      if (nErr) return json({ success: false, error: "Pläne konnten nicht geladen werden.", code: "DB" });

      const { data: authUsers, error: aErr } = await sb.auth.admin.listUsers();
      if (aErr) return json({ success: false, error: "Pläne konnten nicht geladen werden.", code: "AUTH_ADMIN" });

      const plans = [
        ...(workout || []).map((p: any) => ({ ...p, type: "workout" as const, user_email: authUsers.users.find((u: any) => u.id === p.user_id)?.email ?? "N/A" })),
        ...(nutrition || []).map((p: any) => ({ ...p, type: "nutrition" as const, user_email: authUsers.users.find((u: any) => u.id === p.user_id)?.email ?? "N/A" })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return json({ success: true, plans });
    }

    return json({ success: false, error: "Unbekannte Aktion.", code: "BAD_REQUEST" });
  } catch (e) {
    // Return a clear, surfaced error code
    return json({ success: false, error: "Unerwarteter Fehler.", code: "ERROR" });
  }
});