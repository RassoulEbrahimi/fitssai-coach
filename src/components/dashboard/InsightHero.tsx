import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Flame, Clock, Calendar, AlertCircle, TrendingUp, CheckCircle2, Sparkles } from 'lucide-react';
import { Insight } from '@/lib/insights/types';
import { Button } from '@/components/ui/button';
import { GradientCard } from '@/components/micro/GradientCard';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useAINudge } from '@/hooks/useAINudge';

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

    // Call AI Nudge Hook (always valid to call, handles null insight internally)
    const { nudge, isLoading: isAILoading } = useAINudge(insight);

    if (!insight) return null;

    const Icon = insight.icon && IconMap[insight.icon] ? IconMap[insight.icon] : SparklesIcon;

    // Use AI content if available, otherwise deterministic fallback
    const displayTitle = nudge?.title || insight.title;
    const displayMessage = nudge?.message || insight.message;
    const isAIActive = !!nudge; // For UI styling (e.g. sparkles)

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

                    {/* AI Sparkle Indicator (Top Right) */}
                    {isAIActive && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="absolute top-2 right-2"
                        >
                            <Sparkles className="w-4 h-4 text-amber-400 opacity-60 animate-pulse" />
                        </motion.div>
                    )}

                    <div className="flex items-start gap-4">
                        {/* Icon Container */}
                        <div className={cn(
                            "p-3 rounded-2xl flex-shrink-0 transition-transform group-hover:scale-110 duration-300 relative",
                            insight.priority === 'high' ? "bg-primary/20 text-primary" :
                                insight.priority === 'medium' ? "bg-orange-500/20 text-orange-500" :
                                    "bg-blue-500/20 text-blue-500"
                        )}>
                            <Icon className="w-6 h-6" />
                            {isAILoading && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full animate-ping opacity-75" />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                            <motion.div
                                key={isAIActive ? 'ai' : 'static'} // Trigger animation on text switch
                                initial={{ opacity: 0.8 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.5 }}
                            >
                                <h3 className="font-semibold text-lg leading-tight text-foreground mb-1">
                                    {displayTitle}
                                </h3>
                                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                                    {displayMessage}
                                </p>
                            </motion.div>

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

