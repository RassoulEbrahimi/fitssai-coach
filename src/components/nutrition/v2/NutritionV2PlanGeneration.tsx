import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NutritionDate } from "@shared/nutrition";
import { useProfile } from "@/hooks/queries/useProfile";
import {
  useActiveNutritionV2Generation,
  useActiveNutritionV2Plan,
  useCurrentNutritionV2Target,
  useNutritionV2Access,
} from "@/hooks/queries/useNutritionV2";
import { useNutritionV2TargetFreshness } from "@/hooks/queries/useNutritionV2Target";
import {
  isNutritionV2RequestPlanUnavailableError,
  useNutritionV2RequestPlan,
} from "@/hooks/queries/useNutritionV2RequestPlan";
import { nutritionProfileOf } from "@/lib/nutrition/v2/targetSetup";
import {
  deriveNutritionV2GenerationAction,
  nutritionV2GenerationRefusalMessage,
  nutritionV2GenerationResultMessage,
  type NutritionV2GenerationKind,
  type NutritionV2GenerationMessage,
} from "@/lib/nutrition/v2/planGeneration";

/**
 * The explicit "create a Nutrition plan" action of Today (NUT-14), over the
 * one generation hook (`useNutritionV2RequestPlan`).
 *
 * - Offered only while the deployed backend says it can generate
 *   (`available`, the live `coachBackendStatus`) and every product
 *   precondition holds (`deriveNutritionV2GenerationAction`). No target: the
 *   target section's setup is the next action, and this shows nothing.
 * - One click is one request: rendering, mounting and refreshing call
 *   nothing, a second click while one is being sent does nothing, and
 *   nothing is retried with a new request id. A regeneration asks once more
 *   before it is sent, because it replaces the plan from tomorrow and uses
 *   one of the month's plans.
 * - The browser sends `{ requestId }` only; the server decides everything
 *   else. Online only; never queued. There is no cancel: leaving the page
 *   does not stop a request, and a refresh shows how it ended.
 * - Answers and refusals are shown as fixed German copy by their stable code,
 *   never as the server's or the SDK's text. The state is this component's,
 *   and every account has its own query client and tree, so nothing carries
 *   over to another account.
 */

interface Outcome {
  uid: string;
  message: NutritionV2GenerationMessage;
}

export const NutritionV2PlanGeneration: React.FC<{ available: boolean; today: NutritionDate }> = ({ available, today }) => {
  const { t } = useTranslation();
  const access = useNutritionV2Access();
  const profile = useProfile();
  const target = useCurrentNutritionV2Target();
  const freshness = useNutritionV2TargetFreshness(target.status === "success" ? target.data : null);
  const activePlan = useActiveNutritionV2Plan();
  const activeRequest = useActiveNutritionV2Generation();
  const request = useNutritionV2RequestPlan();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Set synchronously on the first click, so a second click in the same frame sends nothing.
  const sending = useRef(false);

  const nutritionProfile = useMemo(
    () => (profile.data === undefined || profile.data === null ? null : nutritionProfileOf(profile.data)),
    [profile.data]
  );
  const action = deriveNutritionV2GenerationAction({
    capability: available,
    access,
    profile: nutritionProfile,
    target,
    freshness,
    activePlan,
    activeRequest,
    online: request.online,
    today,
  });
  const uid = access.status === "eligible" ? access.uid : null;
  const shownOutcome = outcome && outcome.uid === uid ? outcome.message : null;

  const generate = async (kind: NutritionV2GenerationKind) => {
    if (sending.current || uid === null) return;
    sending.current = true;
    setOutcome(null);
    try {
      const result = await request.submit();
      setOutcome({ uid, message: nutritionV2GenerationResultMessage(result, kind) });
    } catch (error) {
      // The hook rejects with a stable code (`NutritionRequestPlanCallError`);
      // anything without one is shown as INTERNAL.
      const stable = (error as { code?: unknown } | null)?.code;
      const code = isNutritionV2RequestPlanUnavailableError(error)
        ? error.reason === "offline"
          ? "offline"
          : "INTERNAL"
        : typeof stable === "string"
          ? stable
          : "INTERNAL";
      setOutcome({ uid, message: nutritionV2GenerationRefusalMessage(code) });
    } finally {
      sending.current = false;
      setConfirming(false);
    }
  };

  const message = shownOutcome && (
    <p
      role={shownOutcome.tone === "error" ? "alert" : "status"}
      data-testid="nutrition-v2-generation-outcome"
      data-tone={shownOutcome.tone}
      className="text-sm text-muted-foreground"
    >
      {t(`nutritionV2.generation.${shownOutcome.key}`)}
    </p>
  );

  if (request.isSubmitting) {
    return (
      <section data-testid="nutrition-v2-generation" data-generation="submitting" className="space-y-2 rounded-lg bg-muted/40 p-3">
        <p role="status" aria-busy="true" className="text-sm font-medium text-foreground">
          {t("nutritionV2.generation.submitting")}
        </p>
        <p className="text-sm text-muted-foreground">{t("nutritionV2.generation.submittingDescription")}</p>
      </section>
    );
  }

  if (action.status === "hidden") {
    return message ? <section data-testid="nutrition-v2-generation" data-generation="hidden">{message}</section> : null;
  }

  if (action.status === "targetNeedsReview" || action.status === "dietNotSupported") {
    return (
      <section data-testid="nutrition-v2-generation" data-generation={action.status} className="space-y-2">
        {message}
        <p role="status" className="text-sm text-muted-foreground">
          {t(action.status === "targetNeedsReview" ? "nutritionV2.generation.targetNeedsReview" : "nutritionV2.generation.refusal.DIETARY_PREFERENCE_NOT_SUPPORTED")}
        </p>
      </section>
    );
  }

  const { kind } = action;
  const offline = action.status === "offline";
  const label = t(kind === "regenerate" ? "nutritionV2.generation.regenerate" : "nutritionV2.generation.create");

  return (
    <section
      data-testid="nutrition-v2-generation"
      data-generation={offline ? "offline" : confirming ? "confirming" : "available"}
      data-generation-kind={kind}
      className="space-y-3 rounded-lg border border-border p-3"
    >
      {message}
      {confirming && !offline ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">{t("nutritionV2.generation.regenerateConfirm")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" onClick={() => void generate(kind)}>
              {label}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>
              {t("nutritionV2.generation.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t(kind === "regenerate" ? "nutritionV2.generation.regenerateDescription" : "nutritionV2.generation.createDescription")}
          </p>
          <Button
            type="button"
            variant={kind === "regenerate" ? "outline" : "default"}
            className="min-h-11 w-full sm:w-auto"
            disabled={offline}
            onClick={() => (kind === "regenerate" ? setConfirming(true) : void generate(kind))}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {label}
          </Button>
          {offline && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("nutritionV2.generation.offline")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t("nutritionV2.generation.disclaimer")}</p>
        </>
      )}
    </section>
  );
};

NutritionV2PlanGeneration.displayName = "NutritionV2PlanGeneration";
