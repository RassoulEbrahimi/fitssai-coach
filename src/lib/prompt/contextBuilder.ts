export interface UserContextData {
  goal?: string;                  // e.g. "Muskelaufbau", "Abnehmen"
  lastWorkoutType?: 'HighIntensity' | 'Moderate' | 'Light' | null;
  daysSinceLastWorkout?: number;  // e.g. 1
  availableEquipment?: string[];
  averageDuration?: number;       // e.g. 45
  energyLevel?: "high" | "medium" | "low";
  streak?: number;
  recentFocus?: string[];
  recoveryDays?: number;
}

export function buildContextAwarePrompt(
  context: UserContextData,
  dayName: string,
  mode: "full-day" | "single-workout"
): string {
  const duration = context.averageDuration || 45;
  
  // Intelligent focus determination based on recent activity
  let focus = "Full-Body Strength";
  
  if (context.recoveryDays && context.recoveryDays >= 3) {
    focus = "Sanfter Wiedereinstieg";
  } else if (context.lastWorkoutType === 'HighIntensity' && context.recoveryDays === 0) {
    focus = "Mobility & Regeneration";
  } else if (context.recentFocus && context.recentFocus.includes('Legs')) {
    focus = "Upper Body & Core";
  } else if (context.recentFocus && context.recentFocus.includes('Push')) {
    focus = "Pull & Legs";
  }

  // Energy-based intensity adjustment
  const energyHint =
    context.energyLevel === "low"
      ? "Passe die Intensität leicht an, um Erholung zu fördern. Vermeide hochintensive Übungen."
      : context.energyLevel === "high"
      ? "Du kannst heute mit höherer Intensität trainieren. Füge anspruchsvollere Übungen hinzu."
      : "Behalte eine ausgewogene Intensität bei.";

  // Equipment context
  const equipmentText =
    context.availableEquipment && context.availableEquipment.length > 0
      ? `Verfügbare Geräte: ${context.availableEquipment.join(", ")}.`
      : "Nutze hauptsächlich Körpergewicht und minimales Equipment.";

  // Streak motivation
  const streakMotivation =
    context.streak && context.streak >= 5
      ? `Der Nutzer trainiert seit ${context.streak} Tagen konsequent – füge eine motivierende Nachricht hinzu und halte die Qualität hoch.`
      : context.streak && context.streak >= 3
      ? "Guter Trainingsflow – halte die Motivation aufrecht mit abwechslungsreichen Übungen."
      : "";

  // Build the context-aware prompt
  const basePrompt = mode === 'full-day'
    ? `Erstelle einen intelligenten ${duration}-Minuten-Trainingsplan für ${dayName}.`
    : `Erstelle ein fokussiertes ${duration}-minütiges ${focus}-Workout für ${dayName}.`;

  const contextAdditions: string[] = [];
  
  contextAdditions.push(`Trainingsziel: ${context.goal || "Allgemeine Fitness & Gesundheit"}.`);
  contextAdditions.push(`Fokus heute: ${focus}.`);
  contextAdditions.push(equipmentText);
  contextAdditions.push(energyHint);
  
  if (streakMotivation) {
    contextAdditions.push(streakMotivation);
  }
  
  if (context.lastWorkoutType) {
    const lastTypeText = 
      context.lastWorkoutType === 'HighIntensity' ? 'hochintensives' :
      context.lastWorkoutType === 'Moderate' ? 'moderates' : 'leichtes';
    contextAdditions.push(
      `Letztes Training war ${lastTypeText}${context.recoveryDays ? ` vor ${context.recoveryDays} Tag(en)` : ' gestern'}.`
    );
  }
  
  if (context.recentFocus && context.recentFocus.length > 0) {
    contextAdditions.push(
      `Kürzlich trainierte Bereiche: ${context.recentFocus.join(', ')} – variiere den Fokus entsprechend.`
    );
  }

  return `${basePrompt}\n\n${contextAdditions.join('\n')}`;
}

/**
 * Generate a user-friendly analysis message based on context
 */
export function getContextAnalysisMessage(context: UserContextData): string {
  const messages: string[] = [];
  
  if (context.streak && context.streak >= 5) {
    messages.push(`🔥 Beeindruckende ${context.streak}-Tage-Serie!`);
  }
  
  if (context.lastWorkoutType === 'HighIntensity' && context.recoveryDays === 0) {
    messages.push('💆‍♂️ Nach intensivem Training gestern empfehle ich Regeneration.');
  } else if (context.recoveryDays && context.recoveryDays >= 3) {
    messages.push('🌟 Zeit für einen sanften Wiedereinstieg nach der Pause.');
  }
  
  if (context.recentFocus && context.recentFocus.length > 0) {
    const focusText = context.recentFocus.slice(0, 2).join(' & ');
    messages.push(`📊 Letzte Fokus-Bereiche: ${focusText}`);
  }
  
  return messages.length > 0 
    ? messages.join('\n')
    : '🧠 FitssAI hat deine Trainingshistorie analysiert...';
}
