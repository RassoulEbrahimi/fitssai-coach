import { getUserFeedbackSummary } from "@/integrations/supabase/ai_adaptation";

export async function buildAdaptivePrompt(userId: string, basePrompt: string): Promise<string> {
  try {
    const feedback = await getUserFeedbackSummary(userId);
    let prompt = basePrompt;

    // 🧩 Fallback if prompt is empty
    if (!prompt || prompt.trim().length < 10) {
      console.warn("[AdaptivePrompt] Base prompt was empty. Using fallback.");
      prompt = "Erstelle ein 30-minütiges Ganzkörper-Workout mit Fokus auf Kraft, Core und Ausdauer.";
    }

    // No feedback yet - return prompt (with fallback applied if needed)
    if (feedback.total === 0) {
      return prompt;
    }

    // Intensity adjustments based on feedback patterns
    if (feedback.hard > feedback.light * 1.5) {
      prompt += "\n\nWICHTIG: Der Nutzer fand vorherige Workouts oft zu anstrengend. Passe die Intensität leicht nach unten an, reduziere Gewichte um 10-15% und füge mehr Pausenzeit ein.";
    } else if (feedback.light > feedback.hard * 1.5) {
      prompt += "\n\nWICHTIG: Der Nutzer sucht mehr Herausforderung. Erhöhe die Intensität leicht, füge progressive Überlastung hinzu und reduziere Pausenzeiten.";
    }

    // Style variation if user is not satisfied
    if (feedback.notstyle > 3 && feedback.notstyle > feedback.super) {
      prompt += "\n\nWICHTIG: Der Nutzer wünscht sich mehr Variation. Wechsle den Trainingsstil, probiere neue Übungsvarianten aus und bringe mehr Abwechslung rein (z.B. Supersätze, Dropsets, oder andere Trainingsmethoden).";
    }

    // Reinforce successful patterns
    if (feedback.super > feedback.total * 0.7) {
      prompt += "\n\nHINWEIS: Der Nutzer ist sehr zufrieden mit dem aktuellen Stil. Behalte die aktuelle Intensität und Struktur bei, aber bringe kleine Variationen für kontinuierliche Progression.";
    }

    return prompt;
  } catch (error) {
    console.error("[AdaptivePrompt] Error building prompt:", error);
    // Absolute fallback prompt if all else fails
    return "Erstelle ein 30-minütiges funktionelles Workout mit Fokus auf Kraft und Stabilität. Inklusive Aufwärmen, Hauptteil, Cooldown.";
  }
}

export function getAdaptiveHintMessage(totalFeedback: number, hardCount: number, lightCount: number, nostyleCount: number, superCount: number): string {
  if (totalFeedback === 0) {
    return "";
  }

  const messages: string[] = [];

  if (hardCount > lightCount * 1.5) {
    messages.push("Intensität wird reduziert");
  } else if (lightCount > hardCount * 1.5) {
    messages.push("Intensität wird erhöht");
  }

  if (nostyleCount > 3 && nostyleCount > superCount) {
    messages.push("mehr Variation geplant");
  }

  if (superCount > totalFeedback * 0.7) {
    messages.push("aktueller Stil beibehalten");
  }

  return messages.length > 0 
    ? `Angepasst: ${messages.join(", ")}` 
    : "Feedback analysiert";
}
