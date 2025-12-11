
import { NutritionPlanContent, WorkoutPlanContent } from './types.ts';

export function buildMockPlansDE(profile: { fitness_goal?: string; dietary_preference?: string }): { workout: WorkoutPlanContent; nutrition: NutritionPlanContent } {
    // console.log("Generating mock plans for profile:", profile); 

    // Structure to match what Dashboard expects
    const workout: WorkoutPlanContent = {
        "Week 1": [
            {
                day: 'Montag',
                exercises: [
                    { name: 'Kniebeugen', sets: '3', reps: '12', weight: 'Körpergewicht' },
                    { name: 'Liegestütze', sets: '3', reps: '10', weight: 'Körpergewicht' },
                    { name: 'Rudern', sets: '3', reps: '12', weight: 'Leicht' },
                    { name: 'Plank', sets: '3', reps: '30s', weight: 'Körpergewicht' }
                ]
            },
            {
                day: 'Dienstag',
                exercises: [
                    { name: 'Joggen', sets: '1', reps: '25-35 Min', weight: 'Cardio' },
                    { name: 'Dehnen', sets: '1', reps: '10 Min', weight: 'Beweglichkeit' }
                ]
            },
            {
                day: 'Mittwoch',
                exercises: [
                    { name: 'Schulterdrücken', sets: '3', reps: '12', weight: 'Leicht' },
                    { name: 'Rudern', sets: '3', reps: '12', weight: 'Leicht' },
                    { name: 'Core Training', sets: '3', reps: '15', weight: 'Körpergewicht' }
                ]
            },
            {
                day: 'Donnerstag',
                exercises: [
                    { name: 'Spazieren', sets: '1', reps: '20-30 Min', weight: 'Erholung' },
                    { name: 'Mobility', sets: '1', reps: '10 Min', weight: 'Beweglichkeit' }
                ]
            },
            {
                day: 'Freitag',
                exercises: [
                    { name: 'Ausfallschritte', sets: '3', reps: '12 je Bein', weight: 'Körpergewicht' },
                    { name: 'Glute Bridge', sets: '3', reps: '15', weight: 'Körpergewicht' },
                    { name: 'Wadenheben', sets: '3', reps: '15', weight: 'Körpergewicht' }
                ]
            },
            {
                day: 'Samstag',
                exercises: [
                    { name: 'Intervall Training', sets: '1', reps: '20-25 Min', weight: 'Cardio' }
                ]
            },
            {
                day: 'Sonntag',
                exercises: [
                    { name: 'Ruhetag', sets: '1', reps: 'Optional: Spaziergang', weight: 'Erholung' }
                ]
            }
        ]
    };

    const nutrition: NutritionPlanContent = {
        "Frühstück": [
            { name: 'Haferflocken mit Joghurt', ingredients: 'Haferflocken, Joghurt, Beeren, Nüsse', calories: '~350 kcal' }
        ],
        "Mittag": [
            { name: 'Hähnchen mit Vollkornreis', ingredients: 'Hähnchen/Tofu, Vollkornreis, Gemüse', calories: '~450 kcal' }
        ],
        "Abend": [
            { name: 'Lachs mit Ofengemüse', ingredients: 'Lachs/Bohnen, Ofengemüse, Salat', calories: '~400 kcal' }
        ],
        "Snacks": [
            { name: 'Gesunde Snacks', ingredients: 'Quark/Skyr, Obst, Nüsse, Karotten mit Hummus', calories: '~150 kcal' }
        ]
    };

    return { workout, nutrition };
}
