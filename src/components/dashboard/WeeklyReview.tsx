import React from "react";
import { motion } from "framer-motion";
import { CalendarCheck, Clock, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { GradientCard } from "@/components/micro/GradientCard";
import {
  durationCaption,
  durationText,
  historyNote,
  primarySuggestion,
  suggestionText,
  type WeeklyCoachingFacts,
} from "@/lib/coaching";
import type { WeeklyReviewMetrics } from "@shared/weeklyRecommendation";
import { CoachingRecommendation } from "./CoachingRecommendation";

/**
 * "Wochenrückblick" — the deterministic week in numbers.
 *
 * Every value in the metric row comes from the coaching engine, which computes
 * it from logged data. None of it is generated, so none of it carries a
 * sparkle, a badge or a mention of KI: presenting arithmetic as if a model
 * produced it would be the same untruth PR46 removed.
 *
 * `metrics` adds the coaching recommendation below the numbers. It is optional
 * so the numbers stand on their own — and because the recommendation section
 * owns its own state and its own honesty about where its wording came from,
 * which is its business rather than this component's.
 */

interface WeeklyReviewProps {
  facts: WeeklyCoachingFacts;
  /** Enables the "Empfehlung für dich" section. Advice only; changes nothing. */
  metrics?: WeeklyReviewMetrics;
  /** Opens the plan for reading. Never a mutation. */
  onViewPlan?: () => void;
  className?: string;
}

const Metric: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  caption?: string | null;
  className?: string;
}> = ({ icon: Icon, label, value, caption, className }) => (
  <div className={cn("flex items-start gap-2 min-w-0", className)}>
    <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    </div>
    <div className="min-w-0">
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="block text-sm font-semibold text-foreground break-words">{value}</span>
      {caption && <span className="block text-[11px] text-muted-foreground">{caption}</span>}
    </div>
  </div>
);

export const WeeklyReview: React.FC<WeeklyReviewProps> = ({
  facts,
  metrics,
  onViewPlan,
  className,
}) => {
  const suggestion = primarySuggestion(facts);
  const { adherence, duration, history } = facts;
  const note = historyNote(history);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("w-full", className)}
      aria-label="Wochenrückblick"
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <CalendarCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Wochenrückblick
        </h2>
      </div>

      <GradientCard className="p-4">
        {!facts.hasAnyData ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" role="status">
              Noch keine Trainingsdaten für diese Woche.
            </p>
            {/* Still worth a recommendation: "start somewhere" is true and useful. */}
            {metrics && (
              <CoachingRecommendation
                metrics={metrics}
                onViewPlan={onViewPlan}
                className="pt-3 border-t border-border/40"
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric
                icon={ListChecks}
                label="Trainingstage"
                value={`${adherence.completedDays} von ${adherence.scheduledDays}`}
              />
              {adherence.adherencePercent !== null && (
                <Metric
                  icon={CalendarCheck}
                  label="Erledigt"
                  value={`${adherence.adherencePercent} %`}
                />
              )}
              <Metric
                icon={Clock}
                label="Dauer"
                value={durationText(duration)}
                caption={durationCaption(duration)}
                // The longest value of the three ("mind. 2 Std. 15 Min."), so
                // it gets the full row on a narrow screen instead of wrapping.
                className="col-span-2 sm:col-span-1"
              />
            </div>

            {suggestion && (
              <p className="text-sm text-foreground leading-relaxed break-words">
                {suggestionText(suggestion)}
              </p>
            )}

            {/* Only when incomplete older records actually limit the numbers above. */}
            {note && <p className="text-[11px] text-muted-foreground leading-relaxed">{note}</p>}

            {metrics && (
              <CoachingRecommendation
                metrics={metrics}
                onViewPlan={onViewPlan}
                className="pt-3 border-t border-border/40"
              />
            )}
          </div>
        )}
      </GradientCard>
    </motion.section>
  );
};
