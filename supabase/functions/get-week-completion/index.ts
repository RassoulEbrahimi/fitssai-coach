import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getWeekDateRange } from "../_shared/dateUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  planId: string;
  weekKey: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Verify user from auth token
    const sbAuth = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await sbAuth.auth.getUser();
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { planId, weekKey }: RequestBody = await req.json();

    if (!planId || !weekKey) {
      return new Response(
        JSON.stringify({ error: "Missing planId or weekKey" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[get-week-completion] Fetching week completion for user ${user.id}, plan ${planId}, week ${weekKey}`);

    // Fetch workout plan to calculate workout_day dates
    const { data: plan, error: planError } = await sb
      .from("workout_plans")
      .select("id, created_at")
      .eq("id", planId)
      .eq("user_id", user.id)
      .single();

    if (planError || !plan) {
      console.error("Plan fetch error:", planError);
      return new Response(
        JSON.stringify({ error: "Plan not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate date range for the week using Berlin timezone
    const { startStr: weekStartStr, endStr: weekEndStr } = getWeekDateRange(
      plan.created_at,
      weekKey
    );

    console.log(`[get-week-completion] Week date range (Berlin): ${weekStartStr} to ${weekEndStr}`);

    // Fetch all logs for this week in ONE query
    const { data: logs, error: logsError } = await sb
      .from("workout_logs")
      .select("plan_id, week_key, day_index, exercise_index, completed, workout_day")
      .eq("plan_id", planId)
      .eq("week_key", weekKey)
      .gte("workout_day", weekStartStr)
      .lte("workout_day", weekEndStr);

    if (logsError) {
      console.error("Logs fetch error:", logsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch logs" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[get-week-completion] Found ${logs?.length || 0} logs for week ${weekKey}`);

    // Build flat completion map: { "Week 1_0_0": true, "Week 1_0_1": false, ... }
    const completionMap: Record<string, boolean> = {};

    if (logs && logs.length > 0) {
      for (const log of logs) {
        const completionKey = `${weekKey}_${log.day_index}_${log.exercise_index}`;
        completionMap[completionKey] = log.completed;
      }
    }

    console.log(`[get-week-completion] Returning flat completion map with ${Object.keys(completionMap).length} entries`);

    return new Response(
      JSON.stringify({
        success: true,
        completionMap,
        weekKey,
        planId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in get-week-completion:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
