// AI adaptation stub — re-enabled after Firebase Cloud Functions migration.

export interface FeedbackSummary {
  super: number; hard: number; light: number; notstyle: number; total: number;
}

export async function getUserFeedbackSummary(_userId: string): Promise<FeedbackSummary> {
  return { super: 0, hard: 0, light: 0, notstyle: 0, total: 0 };
}

export function getFeedbackInsight(_feedback: FeedbackSummary): string {
  return "KI-Feedback steht derzeit nicht zur Verfügung.";
}
