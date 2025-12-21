
export type InsightType = 'streak' | 'consistency' | 'missed' | 'milestone';

export type InsightPriority = 'high' | 'medium' | 'low';

export interface Insight {
    id: string;
    type: InsightType;
    priority: InsightPriority;
    title: string;
    message: string;
    icon?: string; // Lucide icon name or similar identifier
    payload?: any; // For future extensibility (e.g. specific streak count)
    actionLabel?: string;
    actionType?: 'navigate' | 'dismiss';
    actionTarget?: string; // Route to navigate to
}
