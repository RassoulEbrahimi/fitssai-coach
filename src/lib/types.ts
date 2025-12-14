
export interface Exercise {
    name: string;
    sets: number;
    reps: string;
    weight?: string;
    rest?: string;
    description?: string;
    completed?: boolean;
    notes?: string;
    id?: string;
    duration?: number; // Added for some views
}

export interface DayContent {
    day: string;
    exercises: Exercise[];
    [key: string]: unknown;
}

export type WeekContent = DayContent[];

export interface WorkoutPlanContent {
    [weekKey: string]: WeekContent;
}

export interface WorkoutPlan {
    id: string;
    created_at: string;
    user_id: string;
    content: WorkoutPlanContent;
    name?: string;
    status?: string;
    updated_at?: string;
}
