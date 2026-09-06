import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NUDGE_DELIVERY_NOTE, type TrainingNudge } from "@/lib/nudges";

/**
 * The in-app nudge.
 *
 * This is the channel that is always real: it needs no permission, no service
 * worker and no backend, and it appears the moment the app is opened on a day
 * with an open session. The browser notification is an addition to it, never
 * a replacement — which is why the delivery note sits on the card itself.
 *
 * The only action offered opens the plan. Nothing here completes a day, edits
 * an exercise or touches the plan in any way; dismissing writes to this
 * device's local nudge record and to nothing else.
 */

interface TrainingNudgeCardProps {
  nudges: readonly TrainingNudge[];
  /** Opens the workout plan for reading. Never a mutation. */
  onOpenPlan?: () => void;
  onDismiss?: (key: string) => void;
  className?: string;
}

export const TrainingNudgeCard: React.FC<TrainingNudgeCardProps> = ({
  nudges,
  onOpenPlan,
  onDismiss,
  className,
}) => {
  const [primary, ...secondary] = nudges;
  if (!primary) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={primary.key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        aria-label="Trainingshinweis"
        className={cn(
          "relative rounded-2xl p-4 bg-card/70 backdrop-blur ring-1 ring-border/50",
          className
        )}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/20 text-primary shrink-0">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground leading-snug">
              {primary.title}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{primary.body}</p>

            {secondary.map((nudge) => (
              <p key={nudge.key} className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {nudge.title}
              </p>
            ))}

            {onOpenPlan && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenPlan}
                className="mt-3 h-8 text-xs font-medium"
              >
                Plan öffnen
              </Button>
            )}

            {/* Never "we will remind you later": nothing runs while closed. */}
            <p className="text-[11px] text-muted-foreground/80 mt-3">{NUDGE_DELIVERY_NOTE}</p>
          </div>

          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              aria-label="Hinweis ausblenden"
              /* The day, not the wording: see TrainingNudge.dayKey. */
              onClick={() => onDismiss(primary.dayKey)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </motion.section>
    </AnimatePresence>
  );
};

export default TrainingNudgeCard;
