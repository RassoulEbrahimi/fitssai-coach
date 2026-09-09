import React, { useMemo, useRef, useState } from "react";
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
import { weeklyReviewContextKey, type WeeklyReviewUiContext } from "@/lib/coaching/reviewContext";

/**
 * "Empfehlung für dich" — one suggestion, derived from the week the user
 * actually logged.
 *
 * Three rules shape everything here:
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
 *
 *  3. **It says it about the week it was generated for.** The model's sentence
 *     is held under the context it was requested for — account, plan, week,
 *     the profile the model was told about, and the numbers behind it. Change
 *     any of them and the sentence is no longer current, so it is not
 *     rendered: the section falls back to the deterministic wording for the
 *     week now on screen. That is what stops a late answer about Week 1 from
 *     arriving as Week 2's advice, and what stops last hour's sentence from
 *     surviving a session logged since.
 */

interface CoachingRecommendationProps {
  metrics: WeeklyReviewMetrics;
  /**
   * Who is looking, at which plan and which week. Optional: without it the
   * week still comes from `metrics.weekKey`, so the guard degrades to "same
   * week, same numbers" rather than to nothing at all.
   */
  context?: WeeklyReviewUiContext;
  /** Opens the plan for reading. Never a mutation. */
  onViewPlan?: () => void;
  className?: string;
}

type ExplanationState = "idle" | "loading" | "unavailable" | "quota_exceeded" | "done";

/**
 * What the section is showing, and what it is showing it *for*.
 *
 * Keeping the key beside the value rather than clearing state from an effect
 * is what makes the guard total: there is no render in which a retired
 * sentence is on screen, not even the one before an effect would have run.
 */
interface ExplanationOutcome {
  contextKey: string;
  state: ExplanationState;
  recommendation: WeeklyRecommendation | null;
}

/**
 * Every answer, filed under the context it answers for.
 *
 * A single slot was not enough. Two calls can be open at once — the user asks
 * about Week 1, pages to Week 2 and asks again — and whichever *returns* last
 * wrote the slot, so Week 1's late answer replaced Week 2's. The render guard
 * still refused to show it under Week 2, but the user was left with the
 * deterministic wording and one fewer explanation in their monthly budget.
 *
 * Filing by context removes the race rather than refereeing it: a response can
 * only ever be written where it belongs, so it cannot displace another
 * context's answer no matter when it lands. Nothing is evicted because there
 * is nothing to evict — only a request the user made adds an entry, and the
 * month's quota bounds those long before memory would notice.
 */
type ExplanationOutcomes = Readonly<Record<string, ExplanationOutcome>>;

const STATE_NOTE: Readonly<Partial<Record<ExplanationState, string>>> = {
  unavailable:
    "Die Erklärung vom KI-Coach ist gerade nicht verfügbar. Die Empfehlung oben stammt unverändert aus deinen eigenen Zahlen.",
  quota_exceeded:
    "Für diesen Monat sind keine KI-Erklärungen mehr verfügbar. Die Empfehlung oben stammt aus deinen eigenen Zahlen.",
};

export const CoachingRecommendation: React.FC<CoachingRecommendationProps> = ({
  metrics,
  context,
  onViewPlan,
  className,
}) => {
  /*
    The deterministic recommendation is the default, not the fallback: it is on
    screen before anything is asked of a backend, works offline, and costs
    nothing. A model's answer only ever replaces its wording, and only for the
    exact context that answer was requested for.
  */
  const deterministic = useMemo(() => describeRecommendation(metrics), [metrics]);
  /*
    The identity of what is on screen: account, plan, week, and the numbers
    themselves. Recomputed on every render from props, so a week change, a plan
    change, an account change and a completion that lands from another device
    all move it — and all of them retire the sentence held against the old one.
  */
  const contextKey = weeklyReviewContextKey(context, metrics);
  const [outcomes, setOutcomes] = useState<ExplanationOutcomes>({});
  /* A write only ever touches its own context's entry. See above. */
  const remember = (next: ExplanationOutcome) =>
    setOutcomes((held) => ({ ...held, [next.contextKey]: next }));
  /*
    Every accepted call spends one unit of the month's weekly-summary budget,
    so a second call that overlaps the first buys the user nothing and costs
    them one. `disabled` alone is a render away from being true; this set is
    written the instant the handler runs, which is what makes a double-tap — or
    a tap that lands before React has re-rendered — a single request.

    Keyed by context rather than one boolean: a call in flight for Week 1 must
    not silently swallow the click that asks about Week 2.
  */
  const inFlight = useRef<Set<string>>(new Set());

  /* Anything held under another context is not an answer about this one. */
  const current = outcomes[contextKey] ?? null;
  const state: ExplanationState = current?.state ?? "idle";
  const recommendation = current?.recommendation ?? deterministic;
  const explainable = isExplainableWeek(metrics);

  const requestExplanation = async () => {
    const requestKey = contextKey;
    if (inFlight.current.has(requestKey)) return;
    inFlight.current.add(requestKey);

    /*
      Every write below carries the key the request was made under, so it lands
      on that context's entry and on no other — a late answer can neither be
      rendered as the current week's advice nor take away the answer the
      current week already has. The render above shows only the entry matching
      the context on screen.
    */
    remember({ contextKey: requestKey, state: "loading", recommendation: null });
    try {
      const review = await fetchWeeklyReview({
        weekKey: context?.weekKey ?? metrics.weekKey ?? null,
        planId: context?.planId ?? null,
      });
      if (review.recommendation.source === "ai") {
        remember({
          contextKey: requestKey,
          state: "done",
          recommendation: review.recommendation,
        });
        return;
      }
      // The backend fell back to its own wording — which is the same wording
      // already on screen, so nothing changes except the note explaining why.
      remember({
        contextKey: requestKey,
        state: review.aiStatus === "quota_exceeded" ? "quota_exceeded" : "unavailable",
        recommendation: null,
      });
    } catch {
      remember({ contextKey: requestKey, state: "unavailable", recommendation: null });
    } finally {
      inFlight.current.delete(requestKey);
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
        {explainable && state !== "done" && state !== "quota_exceeded" && (
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
            ) : state === "unavailable" ? (
              "Erneut versuchen"
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
