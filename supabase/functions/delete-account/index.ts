import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    console.log(`Starting account deletion for user: ${userId}`);

    // Delete user data from all related tables
    // 1. Delete workout logs
    const { error: workoutLogsError } = await supabaseClient
      .from('workout_logs')
      .delete()
      .eq('user_id', userId);
    
    if (workoutLogsError) {
      console.error('Error deleting workout logs:', workoutLogsError);
      throw workoutLogsError;
    }

    // 2. Delete workout plans
    const { error: workoutPlansError } = await supabaseClient
      .from('workout_plans')
      .delete()
      .eq('user_id', userId);
    
    if (workoutPlansError) {
      console.error('Error deleting workout plans:', workoutPlansError);
      throw workoutPlansError;
    }

    // 3. Delete nutrition plans
    const { error: nutritionPlansError } = await supabaseClient
      .from('nutrition_plans')
      .delete()
      .eq('user_id', userId);
    
    if (nutritionPlansError) {
      console.error('Error deleting nutrition plans:', nutritionPlansError);
      throw nutritionPlansError;
    }

    // 4. Delete profile
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .delete()
      .eq('id', userId);
    
    if (profileError) {
      console.error('Error deleting profile:', profileError);
      throw profileError;
    }

    // 5. Delete user from auth (this will cascade to any remaining data)
    const { error: authDeleteError } = await supabaseClient.auth.admin.deleteUser(userId);
    
    if (authDeleteError) {
      console.error('Error deleting auth user:', authDeleteError);
      throw authDeleteError;
    }

    console.log(`Successfully deleted account for user: ${userId}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Account successfully deleted' 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in delete-account function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to delete account',
        details: error 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
