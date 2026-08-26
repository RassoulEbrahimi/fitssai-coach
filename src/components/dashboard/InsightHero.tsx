import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Flame, Clock, Calendar, AlertCircle, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Insight } from '@/lib/insights/types';
import { Button } from '@/components/ui/button';
import { GradientCard } from '@/components/micro/GradientCard';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface InsightHeroProps {
    insight: Insight | null;
    onDismiss?: () => void;
    className?: string;
}

const IconMap: Record<string, React.ElementType> = {
    'Trophy': Trophy,
    'Flame': Flame,
    'Clock': Clock,
    'Calendar': Calendar,
    'AlertCircle': AlertCircle,
    'TrendingUp': TrendingUp,
    'CheckCircle2': CheckCircle2
};

export const InsightHero: React.FC<InsightHeroProps> = ({ insight, onDismiss, className }) => {
    const navigate = useNavigate();

    if (!insight) return null;

    const Icon = insight.icon && IconMap[insight.icon] ? IconMap[insight.icon] : SparklesIcon;

    /*
      The title and message come straight from the deterministic insights
      engine. They used to be swapped for `useAINudge` output, which was a
      hardcoded string table behind a fake 1.5s delay, and were then badged
      with a sparkle that told the user a model had written them. Nothing
      generates text in this app yet, so the insight speaks for itself.
    */
    const displayTitle = insight.title;
    const displayMessage = insight.message;

    const handleAction = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (insight.actionType === 'navigate' && insight.actionTarget) {
            if (insight.actionTarget === 'workout') {
                navigate('/workout'); // Or emit event
            } else {
                navigate(insight.actionTarget);
            }
        }
        if (insight.actionType === 'dismiss' && onDismiss) {
            onDismiss();
        }
    };

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={insight.id}
                initial={{ opacity: 0, height: 0, scale: 0.95 }}
                animate={{ opacity: 1, height: 'auto', scale: 1 }}
                exit={{ opacity: 0, height: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={cn("w-full mb-6", className)}
            >
                <GradientCard className="p-4 sm:p-5 relative overflow-hidden group cursor-default">

                    <div className="flex items-start gap-4">
                        {/* Icon Container */}
                        <div className={cn(
                            "p-3 rounded-2xl flex-shrink-0 transition-transform group-hover:scale-110 duration-300 relative",
                            insight.priority === 'high' ? "bg-primary/20 text-primary" :
                                insight.priority === 'medium' ? "bg-orange-500/20 text-orange-500" :
                                    "bg-blue-500/20 text-blue-500"
                        )}>
                            <Icon className="w-6 h-6" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                            <h3 className="font-semibold text-lg leading-tight text-foreground mb-1">
                                {displayTitle}
                            </h3>
                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                                {displayMessage}
                            </p>

                            {/* Action Button (if present) */}
                            {(insight.actionLabel) && (
                                <div className="mt-3 flex items-center gap-3">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleAction}
                                        className="h-8 text-xs font-medium bg-background/50 hover:bg-background/80 backdrop-blur-sm border-0 shadow-sm"
                                    >
                                        {insight.actionLabel}
                                        {insight.actionType === 'navigate' && <div className="ml-1.5 opacity-70">➜</div>}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </GradientCard>
            </motion.div>
        </AnimatePresence>
    );
};

// Fallback icon
const SparklesIcon = ({ className }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
);

