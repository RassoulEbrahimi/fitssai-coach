import { supabase } from "@/integrations/supabase/client";

export interface AIFeedback {
  id?: string;
  user_id: string;
  suggestion_id?: string;
  accepted: boolean;
  reason?: string;
  created_at?: string;
  updated_at?: string;
}

export async function saveAIFeedback(feedback: Omit<AIFeedback, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from("ai_feedback")
    .insert([feedback])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getAIFeedbackByUser(userId: string) {
  const { data, error } = await supabase
    .from("ai_feedback")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getAIFeedbackBySuggestion(suggestionId: string) {
  const { data, error } = await supabase
    .from("ai_feedback")
    .select("*")
    .eq("suggestion_id", suggestionId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function updateAIFeedback(id: string, updates: Partial<Pick<AIFeedback, 'accepted' | 'reason'>>) {
  const { data, error } = await supabase
    .from("ai_feedback")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
