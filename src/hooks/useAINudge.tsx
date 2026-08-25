import { useState, useEffect } from 'react';
import { Insight } from '@/lib/insights/types';

interface AINudgeResponse {
    title: string;
    message: string;
    isAI: boolean;
}

// Mock AI responses for MVP
const MOCK_RESPONSES: Record<string, (payload: any) => { title: string, message: string }> = {
    'missed': (payload) => ({
        title: "Lange nichts gehört... 👀",
        message: `Bereit für ein Comeback? ${payload.daysSinceLast || 4} Tage Pause sind okay, aber heute ist der perfekte Tag für 10 Minuten!`
    }),
    'milestone': (payload) => ({
        title: `Wow! ${payload.milestone} Workouts! 🎉`,
        message: "Du bist offiziell eine Maschine. Feier diesen Meilenstein, das hast du dir verdient!"
    }),
    'streak': (payload) => ({
        title: "Du brennst! 🔥",
        message: `${payload.activeDays} Tage diese Woche. Dein Momentum ist unaufhaltsam. Weiter so!`
    }),
    'consistency': () => ({
        title: "Wochenmitte-Boost 🚀",
        message: "Die Woche ist halb rum – der perfekte Moment, um dranzubleiben!"
    })
};

export const useAINudge = (insight: Insight | null) => {
    const [nudge, setNudge] = useState<AINudgeResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!insight || !insight.payload) {
            setNudge(null);
            return;
        }

        // Check session cache to avoid re-generating
        const cacheKey = `fitssai.ai-nudge.${insight.id}`;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            setNudge(JSON.parse(cached));
            return;
        }

        // Simulate AI Latency
        setIsLoading(true);
        const timer = setTimeout(() => {
            const generator = MOCK_RESPONSES[insight.type];

            if (generator) {
                const aiContent = generator(insight.payload);
                const response: AINudgeResponse = {
                    ...aiContent,
                    isAI: true
                };

                sessionStorage.setItem(cacheKey, JSON.stringify(response));
                setNudge(response);
            } else {
                // Fallback if no specific generator
                setNudge(null);
            }

            setIsLoading(false);
        }, 1500); // 1.5s delay to feel like "AI thinking"

        return () => clearTimeout(timer);
    }, [insight]);

    return { nudge, isLoading };
};
