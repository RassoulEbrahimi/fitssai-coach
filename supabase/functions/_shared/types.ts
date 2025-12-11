
export interface GeneratePlansRequest {
    user_id?: string; // Optional, usually derived from auth unless admin
}

export interface Profile {
    age?: number;
    height?: number;
    weight?: number;
    fitness_goal?: string;
    dietary_preference?: string;
    experience_level?: string;
}

export interface Exercise {
    name: string;
    sets: string;
    reps: string;
    weight?: string;
    rest?: string;
}

export interface DayPlan {
    day: string;
    exercises: Exercise[];
}

export interface WeekPlan {
    [dayKey: string]: DayPlan[] | undefined; // "Week 1": [...]
}

// Normalized structure as expected by frontend/DB
export interface WorkoutPlanContent {
    [weekKey: string]: DayPlan[];
}

export interface Meal {
    name: string; // "meal" in some contexts, normalized to name? Schema says 'meal' often, but let's check usage. 
    // In existing code: "meal": "Meal name". Wait, buildMockPlansDE uses { name: ... }?
    // Let's re-read buildMockPlansDE.
    // "Frühstück": [{ name: '...', ingredients: '...', calories: '...' }]
    // Prompt asks for: "meal": "Meal name".
    // Let's stick to what's in buildMockPlansDE as the "safe" fallback, but verify if the prompt output differs.
    // Prompt output: "meal": "Meal name".
    // Mock output: { name: '...', ... }
    // This is a discrepancy in existing code! The mock returns `name`, the prompt asks for `meal`.
    // I should probably support both or normalize it.
    // existing code: `mock.nutrition` uses `name`.
    // The frontend probably expects `name`. Let's assume `name` is the target.
    ingredients?: string;
    calories?: string | number;
    description?: string;
}

export interface NutritionPlanContent {
    [mealType: string]: Meal[];
}

export interface GeneratePlansResponse {
    success: boolean;
    workoutPlan?: WorkoutPlanContent;
    nutritionPlan?: NutritionPlanContent;
    error?: string | object;
    code?: string;
    warning?: string;
    source?: string;
}
