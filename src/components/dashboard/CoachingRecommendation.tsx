import React, { useMemo, useState } from "react";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  describeRecommendation,
  isExplainableWeek,
  type WeeklyRecommendation,
  type WeeklyReviewMetrics,
} from "@shared/weeklyRecommendation";
import { fetchWeeklyReview } from "@/lib/backend/weeklyReview";

/**
 * "Empfehlung für dich" — one suggestion, derived from the week the user
 * actually logged.
 *
 * Two rules shape everything here:
 *
 *  1. **It is a suggestion.** Nothing in this component, and nothing behind
 *     the button in it, edits a workout plan. The copy says so in as many
 *     words, and the only other action offered is to look at the plan.
 *
 *  2. **It says where the words came from.** The recommendation is always
 *     available, computed from the user's own numbers. A model can be asked to
 *     phrase the same conclusion more naturally, on an explicit click — and
 *     when it has, the section says so. Deterministic wording is never dressed
 *     up as a model's, and a failed model call never invents one.
 */

interface CoachingRecommendationProps {
  metrics: WeeklyReviewMetrics;
  /** Opens the plan for reading. Never a mutation. */
  onViewPlan?: () => void;
  className?: string;
}

type ExplanationState = "idle" | "loading" | "unavailable" | "quota_exceeded" | "done";

const STATE_NOTE: Readonly<Partial<Record<ExplanationState, string>>> = {
  unavailable:
    "Die Erklärung vom KI-Coach ist gerade nicht verfügbar. Die Empfehlung oben stammt unverändert aus deinen eigenen Zahlen.",
  quota_exceeded:
    "Für diesen Monat sind keine KI-Erklärungen mehr verfügbar. Die Empfehlung oben stammt aus deinen eigenen Zahlen.",
};

export const CoachingRecommendation: React.FC<CoachingRecommendationProps> = ({
  metrics,
  onViewPlan,
  className,
}) => {
  /*
    The deterministic recommendation is the default, not the fallback: it is on
    screen before anything is asked of a backend, works offline, and costs
    nothing. `fromModel` only ever replaces its wording.
  */
  const deterministic = useMemo(() => describeRecommendation(metrics), [metrics]);
  const [fromModel, setFromModel] = useState<WeeklyRecommendation | null>(null);
  const [state, setState] = useState<ExplanationState>("idle");

  const recommendation = fromModel ?? deterministic;
  const explainable = isExplainableWeek(metrics);

  const requestExplanation = async () => {
    setState("loading");
    try {
      const review = await fetchWeeklyReview();
      if (review.recommendation.source === "ai") {
        setFromModel(review.recommendation);
        setState("done");
        return;
      }
      // The backend fell back to its own wording — which is the same wording
      // already on screen, so nothing changes except the note explaining why.
      setState(review.aiStatus === "quota_exceeded" ? "quota_exceeded" : "unavailable");
    } catch {
      setState("unavailable");
    }
  };

  const note = STATE_NOTE[state];

  return (
    <section
      className={cn("space-y-2", className)}
      aria-label="Empfehlung für dich"
    >
      <div className="flex items-center gap-2">
        <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Empfehlung für dich
        </h3>
        {recommendation.source === "ai" && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            Formulierung vom KI-Coach
          </span>
        )}
      </div>

      <p className="text-sm font-semibold text-foreground break-words">
        {recommendation.headline}
      </p>
      <p className="text-sm text-foreground leading-relaxed break-words">
        {recommendation.message}
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
        {recommendation.reason}
      </p>

      {/*
        Said plainly, every time. A suggestion that looks like an announcement
        is the thing this feature must never be mistaken for.
      */}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Das ist eine Empfehlung. Dein Trainingsplan wird dadurch nicht verändert — du
        entscheidest, was du übernimmst.
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {explainable && state !== "done" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={requestExplanation}
            disabled={state === "loading"}
          >
            {state === "loading" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                Wird formuliert …
              </>
            ) : (
              "Vom KI-Coach erklären lassen"
            )}
          </Button>
        )}

        {onViewPlan && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={onViewPlan}
          >
            Plan ansehen
          </Button>
        )}
      </div>

      {note && (
        <p className="text-[11px] text-muted-foreground leading-relaxed" role="status">
          {note}
        </p>
      )}
    </section>
  );
};
