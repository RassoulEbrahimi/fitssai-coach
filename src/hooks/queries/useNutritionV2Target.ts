import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  deriveNutritionTargetFreshness,
  type NutritionSetTargetResult,
  type NutritionTargetFreshness,
  type NutritionTargetMode,
  type TargetVersion,
} from "@shared/nutrition";
import { useProfile } from "@/hooks/queries/useProfile";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import { callNutritionSetTarget } from "@/lib/nutrition/v2/targetCallable";
import { nutritionProfileOf } from "@/lib/nutrition/v2/targetSetup";
import { webSha256Hex } from "@/lib/nutrition/v2/sha256";

/**
 * Nutrition V2 TARGET for the signed-in account (NUT-08): setting it, and
 * whether the current one still matches the profile.
 *
 * Setting a target:
 * - happens only through `submit`, called from an explicit confirmation;
 *   mounting or rendering calls nothing and creates no state or target;
 * - only for a signed-in, eligible adult (NUT-03), and only online — there is
 *   no offline target queue; offline, `submit` refuses before anything is sent;
 * - one explicit action is one request id, created once in `submit` and
 *   carried by the mutation's variables, so any retry of that action reuses
 *   it and the server applies it once;
 * - sends `{ mode, requestId }` only. The server rereads the profile, checks
 *   eligibility, applies its target policy and writes the target and the state;
 * - on success refetches exactly the account's state and targets; the
 *   pointer-backed current-target read (`useCurrentNutritionV2Target`)
 *   converges from there. Entries, plans, slots, legacy Nutrition and
 *   Training are not touched.
 *
 * Freshness is derived, never acted on: a stale target stays the current
 * target until the person sets a new one.
 */

export type NutritionV2TargetUnavailableReason = "signedOut" | "pending" | "error" | "ineligible";

export type NutritionV2TargetAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: NutritionV2TargetUnavailableReason };

/** An action refused before anything was sent. */
export class NutritionV2TargetUnavailableError extends Error {
  readonly reason: NutritionV2TargetUnavailableReason | "offline";

  constructor(reason: NutritionV2TargetUnavailableReason | "offline") {
    super(`Setting a Nutrition V2 target is unavailable (${reason})`);
    this.name = "NutritionV2TargetUnavailableError";
    this.reason = reason;
  }
}

export const isNutritionV2TargetUnavailableError = (error: unknown): error is NutritionV2TargetUnavailableError =>
  error instanceof NutritionV2TargetUnavailableError;

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const readOnline = () => navigator.onLine;

export interface NutritionV2TargetMutation {
  availability: NutritionV2TargetAvailability;
  /** Setting a target needs the server; offline it is unavailable. */
  online: boolean;
  /** One explicit action. Rejects with the refusal or a `NutritionTargetCallError`. */
  submit: (mode: NutritionTargetMode) => Promise<NutritionSetTargetResult>;
  isSubmitting: boolean;
}

interface SetTargetVariables {
  uid: string;
  mode: NutritionTargetMode;
  requestId: string;
}

export const useNutritionV2TargetMutation = (): NutritionV2TargetMutation => {
  const access = useNutritionV2Access();
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation<NutritionSetTargetResult, Error, SetTargetVariables>({
    mutationFn: ({ mode, requestId }) => callNutritionSetTarget({ mode, requestId }),
    // Offline is refused in `submit`; TanStack must not park the action for later.
    networkMode: "always",
    retry: false,
    onSuccess: (_result, { uid }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.state(uid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.targets.all(uid) }),
      ]),
  });

  const availability: NutritionV2TargetAvailability =
    access.status === "eligible" ? { status: "available" } : { status: "unavailable", reason: access.status };
  const uid = access.status === "eligible" ? access.uid : null;
  const unavailableReason = availability.status === "unavailable" ? availability.reason : null;

  const submit = useCallback(
    async (mode: NutritionTargetMode): Promise<NutritionSetTargetResult> => {
      if (unavailableReason !== null || uid === null) {
        throw new NutritionV2TargetUnavailableError(unavailableReason ?? "pending");
      }
      if (!navigator.onLine) throw new NutritionV2TargetUnavailableError("offline");
      // Created once, here, for this one action.
      return mutateAsync({ uid, mode, requestId: crypto.randomUUID() });
    },
    [mutateAsync, uid, unavailableReason]
  );

  return { availability, online, submit, isSubmitting: isPending };
};

/* ------------------------------------------------------------------ *
 * Freshness
 * ------------------------------------------------------------------ */

export type NutritionV2TargetFreshness =
  | NutritionTargetFreshness
  /** Still hashing, or the profile is still loading. */
  | { status: "checking" }
  /** The comparison itself failed; nothing is claimed either way. */
  | { status: "unavailable" };

/**
 * Whether `target` still matches the cached profile. Derived only: it reads
 * the profile the app already holds and writes nothing.
 */
export const useNutritionV2TargetFreshness = (target: TargetVersion | null): NutritionV2TargetFreshness => {
  const profile = useProfile();
  const nutritionProfile = useMemo(
    () => (profile.data === undefined ? null : nutritionProfileOf(profile.data)),
    [profile.data]
  );
  const [result, setResult] = useState<{
    target: TargetVersion;
    profile: ReturnType<typeof nutritionProfileOf>;
    freshness: NutritionV2TargetFreshness;
  } | null>(null);

  useEffect(() => {
    if (!target || !nutritionProfile) return undefined;
    let current = true;
    deriveNutritionTargetFreshness(target, nutritionProfile, webSha256Hex).then(
      (freshness) => current && setResult({ target, profile: nutritionProfile, freshness }),
      () => current && setResult({ target, profile: nutritionProfile, freshness: { status: "unavailable" } })
    );
    return () => {
      current = false;
    };
  }, [target, nutritionProfile]);

  if (!target || !nutritionProfile || !result || result.target !== target || result.profile !== nutritionProfile) {
    return { status: "checking" };
  }
  return result.freshness;
};
