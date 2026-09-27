import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  nutritionDateAt,
  type NutritionDate,
  type NutritionSlotId,
  type NutritionUpdateSlotRequest,
  type NutritionUpdateSlotResult,
} from "@shared/nutrition";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import { callNutritionUpdateSlot, isNutritionSlotCallError } from "@/lib/nutrition/v2/slotCallable";

/**
 * Replacing one slot's PLANNED meal, or undoing that, for the signed-in
 * account (NUT-10).
 *
 * - Happens only through `commitPlanMeal`, `commitSuggestion` or `undo`, each
 *   called from one explicit confirmation. Mounting, rendering, opening a
 *   sheet or choosing an option calls nothing.
 * - Only for a signed-in, eligible adult (NUT-03), only online, and only for
 *   today or a later date (Berlin). There is no offline slot queue: offline,
 *   an action is refused before anything is sent, never stored for later.
 * - One action is one request id, created once and carried by the mutation's
 *   variables. `expectedRevision` is the revision of the slot head the person
 *   saw (0 when the slot had none).
 * - Sends ids only; the server resolves the meal from its own data.
 * - Confirmed, never optimistic: nothing is written to the cache. The shown
 *   meal stays as it was while the request is pending, and changes only once
 *   the server has answered and the plan's slot heads
 *   (`queryKeys.nutrition.slots.byPlan`) have been read again — the action
 *   resolves after that refetch.
 * - A refusal names the read that disagreed with the server, and exactly that
 *   is read again — never retried: STALE_REVISION the slot heads,
 *   SLOT_HAS_RECORD the entries, PLAN_CHANGED_FOR_DATE the state and plans. A
 *   second attempt is a new confirmation. Targets, legacy Nutrition and
 *   Training are never touched.
 * - `commitSuggestion` commits a server-held suggestion candidate by its ids.
 *   No production code creates suggestions yet (NUT-12), so no UI offers it.
 */

export type NutritionV2SlotOverrideUnavailableReason = "signedOut" | "pending" | "error" | "ineligible";

export type NutritionV2SlotOverrideAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: NutritionV2SlotOverrideUnavailableReason };

/** An action refused before anything was sent. */
export class NutritionV2SlotOverrideUnavailableError extends Error {
  readonly reason: NutritionV2SlotOverrideUnavailableReason | "offline" | "pastDate";

  constructor(reason: NutritionV2SlotOverrideUnavailableReason | "offline" | "pastDate") {
    super(`Replacing a Nutrition V2 slot is unavailable (${reason})`);
    this.name = "NutritionV2SlotOverrideUnavailableError";
    this.reason = reason;
  }
}

export const isNutritionV2SlotOverrideUnavailableError = (error: unknown): error is NutritionV2SlotOverrideUnavailableError =>
  error instanceof NutritionV2SlotOverrideUnavailableError;

/** One slot of one date of the plan that owns it, at the revision the person saw. */
export interface NutritionV2SlotTarget {
  planId: string;
  date: NutritionDate;
  slotId: NutritionSlotId;
  /** The slot head's revision as read; 0 when the slot has no head. */
  expectedRevision: number;
}

export interface NutritionV2SlotOverride {
  availability: NutritionV2SlotOverrideAvailability;
  /** Replacing needs the server; offline it is unavailable. */
  online: boolean;
  /** Replace the slot with another base meal of the same plan. */
  commitPlanMeal: (target: NutritionV2SlotTarget, sourceMealId: string) => Promise<NutritionUpdateSlotResult>;
  /** Replace the slot with a candidate of a server-held suggestion set. */
  commitSuggestion: (
    target: NutritionV2SlotTarget,
    suggestion: { suggestionSetId: string; candidateId: string }
  ) => Promise<NutritionUpdateSlotResult>;
  /** Select what the selected override replaced. */
  undo: (target: NutritionV2SlotTarget) => Promise<NutritionUpdateSlotResult>;
  isSubmitting: boolean;
}

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const readOnline = () => navigator.onLine;

/** Exactly the address fields: nothing else a caller's object carries is sent. */
const slotAddress = ({ planId, date, slotId, expectedRevision }: NutritionV2SlotTarget): NutritionV2SlotTarget => ({
  planId,
  date,
  slotId,
  expectedRevision,
});

interface SlotVariables {
  uid: string;
  request: NutritionUpdateSlotRequest;
}

export const useNutritionV2SlotOverride = (): NutritionV2SlotOverride => {
  const access = useNutritionV2Access();
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation<NutritionUpdateSlotResult, Error, SlotVariables>({
    mutationFn: ({ request }) => callNutritionUpdateSlot(request),
    // Offline is refused before the call; TanStack must not park the action for later.
    networkMode: "always",
    retry: false,
    // Resolves the action only once the new head has been read.
    onSuccess: async (_result, { uid, request }) => {
      if (request.action === "commit" && request.replacement.source === "aiSuggestion") {
        queryClient.removeQueries({
          queryKey: queryKeys.nutrition.suggestions(uid, request.planId, request.date, request.slotId),
          exact: true,
        });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.slots.byPlan(uid, request.planId) });
    },
    onError: async (error, { uid, request }) => {
      if (!isNutritionSlotCallError(error)) return;
      if (error.code === "STALE_REVISION" || error.code === "NOTHING_TO_UNDO") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.slots.byPlan(uid, request.planId) });
      } else if (error.code === "SLOT_HAS_RECORD") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.entries.all(uid) });
      } else if (error.code === "PLAN_CHANGED_FOR_DATE") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.state(uid) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.plans.all(uid) }),
        ]);
      }
    },
  });

  const availability: NutritionV2SlotOverrideAvailability =
    access.status === "eligible" ? { status: "available" } : { status: "unavailable", reason: access.status };
  const uid = access.status === "eligible" ? access.uid : null;
  const unavailableReason = availability.status === "unavailable" ? availability.reason : null;

  const submit = useCallback(
    (build: (requestId: string) => NutritionUpdateSlotRequest): Promise<NutritionUpdateSlotResult> => {
      if (unavailableReason !== null || uid === null) {
        return Promise.reject(new NutritionV2SlotOverrideUnavailableError(unavailableReason ?? "pending"));
      }
      if (!navigator.onLine) return Promise.reject(new NutritionV2SlotOverrideUnavailableError("offline"));
      // Created once, here, for this one action.
      const request = build(crypto.randomUUID());
      // Only today or later; the server decides again with its own clock.
      if (request.date < nutritionDateAt(new Date())) {
        return Promise.reject(new NutritionV2SlotOverrideUnavailableError("pastDate"));
      }
      return mutateAsync({ uid, request });
    },
    [mutateAsync, uid, unavailableReason]
  );

  const commitPlanMeal = useCallback(
    (target: NutritionV2SlotTarget, sourceMealId: string) =>
      submit((requestId) => ({ action: "commit", requestId, ...slotAddress(target), replacement: { source: "planMeal", sourceMealId } })),
    [submit]
  );

  const commitSuggestion = useCallback(
    (target: NutritionV2SlotTarget, { suggestionSetId, candidateId }: { suggestionSetId: string; candidateId: string }) =>
      submit((requestId) => ({
        action: "commit",
        requestId,
        ...slotAddress(target),
        replacement: { source: "aiSuggestion", suggestionSetId, candidateId },
      })),
    [submit]
  );

  const undo = useCallback(
    (target: NutritionV2SlotTarget) => submit((requestId) => ({ action: "undo", requestId, ...slotAddress(target) })),
    [submit]
  );

  return { availability, online, commitPlanMeal, commitSuggestion, undo, isSubmitting: isPending };
};
