// AI feedback stub — feature disabled during Firebase migration.
export interface AIFeedback {
  id?: string; user_id: string; suggestion_id?: string;
  accepted: boolean; reason?: string; created_at?: string; updated_at?: string;
}

export async function saveAIFeedback(_feedback: Omit<AIFeedback, "id" | "created_at" | "updated_at">): Promise<AIFeedback> {
  throw new Error("AI feedback is temporarily unavailable during Firebase migration.");
}

export async function getAIFeedbackByUser(_userId: string): Promise<AIFeedback[]> { return []; }
export async function getAIFeedbackBySuggestion(_suggestionId: string): Promise<AIFeedback[]> { return []; }
export async function updateAIFeedback(_id: string, _updates: Partial<Pick<AIFeedback, "accepted" | "reason">>): Promise<AIFeedback> {
  throw new Error("AI feedback is temporarily unavailable during Firebase migration.");
}
