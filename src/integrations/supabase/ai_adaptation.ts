import { supabase } from "@/integrations/supabase/client";

export interface FeedbackSummary {
  super: number;
  hard: number;
  light: number;
  notstyle: number;
  total: number;
}

export async function getUserFeedbackSummary(userId: string): Promise<FeedbackSummary> {
  const { data, error } = await supabase
    .from("ai_feedback")
    .select("reason, accepted")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20); // Last 20 feedback entries for recent patterns

  if (error) throw error;

  const counts: FeedbackSummary = {
    super: 0,
    hard: 0,
    light: 0,
    notstyle: 0,
    total: data?.length || 0,
  };

  if (!data) return counts;

  for (const item of data) {
    const reason = item.reason?.toLowerCase() || "";
    
    if (reason.includes("good") || reason === "good" || item.accepted) {
      counts.super++;
    }
    if (reason.includes("hard") || reason === "hard") {
      counts.hard++;
    }
    if (reason.includes("light") || reason === "light") {
      counts.light++;
    }
    if (reason.includes("notstyle") || reason === "notstyle") {
      counts.notstyle++;
    }
  }

  return counts;
}

export function getFeedbackInsight(feedback: FeedbackSummary): string {
  if (feedback.total === 0) {
    return "Noch keine Feedback-Daten verfügbar";
  }

  const insights: string[] = [];

  // Intensity adjustments
  if (feedback.hard > feedback.light * 1.5) {
    insights.push("Intensität wird angepasst (einfacher)");
  } else if (feedback.light > feedback.hard * 1.5) {
    insights.push("Intensität wird erhöht (anspruchsvoller)");
  }

  // Style variation
  if (feedback.notstyle > 3 && feedback.notstyle > feedback.super) {
    insights.push("Trainingsstil wird variiert");
  }

  // Positive feedback
  if (feedback.super > feedback.total * 0.7) {
    insights.push("Aktueller Stil wird beibehalten");
  }

  return insights.length > 0
    ? insights.join(", ")
    : "Feedback analysiert, keine Anpassungen nötig";
}
