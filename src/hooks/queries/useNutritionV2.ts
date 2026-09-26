import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/queries/useProfile";
import { queryKeys } from "@/lib/queryKeys";
import {
  getNutritionEligibility,
  isNutritionDate,
  parseNutritionProfile,
  type NutritionDate,
  type NutritionPlan,
  type NutritionUserState,
  type RecordedEntry,
  type SlotHead,
  type TargetVersion,
} from "@shared/nutrition";
import {
  readNutritionV2Entries,
  readNutritionV2Plan,
  readNutritionV2SlotHeads,
  readNutritionV2State,
  readNutritionV2Target,
} from "@/lib/nutrition/v2/firestoreReads";
import { isNutritionV2IntegrityError } from "@/lib/nutrition/v2/integrity";
import type { NutritionV2Access, NutritionV2Read } from "@/lib/nutrition/v2/readStatus";

/**
 * Nutrition V2 reads for the signed-in account. Read-only: there is no V2
 * mutation on the client.
 *
 * - Every key is an account-scoped key from `queryKeys.nutrition.*`.
 * - No read runs unless the account is signed in *and* eligible (NUT-03: an
 *   adult with a known age). Signed out, under 18, missing age or a profile
 *   still loading all read nothing.
 * - Every document is schema-validated; a malformed or mismatched V2 document
 *   is an error, never an empty result. Integrity errors are not retried:
 *   reading the same document again gives the same answer.
 * - There is no resolved-day read. A resolved day is derived from the plan,
 *   its slot heads and the entries (`@/lib/nutrition/v2/resolvedPlan`).
 * - Generation requests and server-only suggestions are not read here.
 */

/* ------------------------------------------------------------------ *
 * Access
 * ------------------------------------------------------------------ */

/** Signed in, and eligible for Nutrition V2 by the NUT-03 contract. */
export const useNutritionV2Access = (): NutritionV2Access => {
  const { user } = useAuth();
  const profile = useProfile();

  if (!user) return { status: "signedOut" };
  if (profile.status === "error") return { status: "error" };
  // Undefined while loading; a profile of another account is never used.
  if (profile.data === undefined || (profile.data !== null && profile.data.id !== user.uid)) {
    return { status: "pending" };
  }

  // The age policy is NUT-03's: a missing or unusable age is never adult.
  const eligibility = getNutritionEligibility(parseNutritionProfile(profile.data ? { age: profile.data.age } : null));
  const { reason } = eligibility;
  return reason === "eligible" ? { status: "eligible", uid: user.uid } : { status: "ineligible", reason };
};

const useEligibleUid = (): string | undefined => {
  const access = useNutritionV2Access();
  return access.status === "eligible" ? access.uid : undefined;
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const retryUnlessIntegrity = (failureCount: number, error: unknown) =>
  !isNutritionV2IntegrityError(error) && failureCount < 1;

const requireUid = (uid: string | undefined): string => {
  if (!uid) throw new Error("Nutrition V2 read without an eligible account");
  return uid;
};

/** Narrows a read input the query's `enabled` already required. */
const required = <T>(value: T | null | undefined, label: string): T => {
  if (value === null || value === undefined) throw new Error(`Nutrition V2 read without ${label}`);
  return value;
};

const toRead = <T, E>(query: UseQueryResult<T, E>, enabled: boolean): NutritionV2Read<T> => {
  if (!enabled) return { status: "disabled" };
  // An error wins over earlier data: a V2 document that stopped validating is
  // not shown from cache.
  if (query.status === "error") return { status: "error", error: query.error };
  if (query.status === "success") return { status: "success", data: query.data };
  return { status: "pending" };
};

/* ------------------------------------------------------------------ *
 * State and pointers
 * ------------------------------------------------------------------ */

/**
 * `users/{uid}/nutrition_v2_state/current`. `null` data: V2 is not
 * initialised for the account. Nothing is reconstructed from other collections.
 */
export const useNutritionV2State = (): NutritionV2Read<NutritionUserState | null> => {
  const uid = useEligibleUid();
  const query = useQuery({
    queryKey: queryKeys.nutrition.state(uid),
    queryFn: () => readNutritionV2State(requireUid(uid)),
    enabled: !!uid,
    retry: retryUnlessIntegrity,
  });
  return toRead(query, !!uid);
};

/**
 * The plan `state.activePlanId` names, read exactly by that id. `null` data
 * when V2 is not initialised or no plan is active. The key carries the plan
 * id, so a new pointer is a new read and never reuses another plan's entry.
 */
export const useActiveNutritionV2Plan = (): NutritionV2Read<NutritionPlan | null> => {
  const uid = useEligibleUid();
  const state = useNutritionV2State();
  const planId = state.status === "success" ? (state.data?.activePlanId ?? null) : null;
  const enabled = !!uid && planId !== null;

  const query = useQuery({
    queryKey: queryKeys.nutrition.plans.byId(uid, planId ?? undefined),
    queryFn: () => readNutritionV2Plan(requireUid(uid), required(planId, "a plan id")),
    enabled,
    retry: retryUnlessIntegrity,
  });

  if (state.status !== "success") return state;
  if (planId === null) return { status: "success", data: null };
  return toRead(query, enabled);
};

/**
 * The target version `state.currentTargetVersionId` names, read exactly by
 * that id. `null` data when V2 is not initialised or no target is set. The
 * key carries the target version id, so a new pointer is a new read and never
 * reuses another version's entry. Nothing is calculated.
 */
export const useCurrentNutritionV2Target = (): NutritionV2Read<TargetVersion | null> => {
  const uid = useEligibleUid();
  const state = useNutritionV2State();
  const targetVersionId = state.status === "success" ? (state.data?.currentTargetVersionId ?? null) : null;
  const enabled = !!uid && targetVersionId !== null;

  const query = useQuery({
    queryKey: queryKeys.nutrition.targets.byId(uid, targetVersionId ?? undefined),
    queryFn: () => readNutritionV2Target(requireUid(uid), required(targetVersionId, "a target version id")),
    enabled,
    retry: retryUnlessIntegrity,
  });

  if (state.status !== "success") return state;
  if (targetVersionId === null) return { status: "success", data: null };
  return toRead(query, enabled);
};

/* ------------------------------------------------------------------ *
 * Slot heads and entries
 * ------------------------------------------------------------------ */

/**
 * The slot heads of `plan` (`planId == plan.planId`), each checked against the
 * plan's dates and configured slots. A slot without a head shows its base meal.
 */
export const useNutritionV2Slots = (plan: NutritionPlan | null | undefined): NutritionV2Read<SlotHead[]> => {
  const uid = useEligibleUid();
  const enabled = !!uid && !!plan;

  const query = useQuery({
    queryKey: queryKeys.nutrition.slots.byPlan(uid, plan?.planId),
    // Plan content is immutable per id, so the key's plan id pins this plan.
    queryFn: () => readNutritionV2SlotHeads(requireUid(uid), required(plan, "a plan")),
    enabled,
    retry: retryUnlessIntegrity,
  });
  return toRead(query, enabled);
};

/** The entries recorded on one Berlin date, exactly as recorded. */
export const useNutritionV2EntriesByDate = (date: NutritionDate | null | undefined): NutritionV2Read<RecordedEntry[]> => {
  const uid = useEligibleUid();
  const enabled = !!uid && isNutritionDate(date);

  const query = useQuery({
    queryKey: queryKeys.nutrition.entries.byDate(uid, date ?? ""),
    queryFn: () => readNutritionV2Entries(requireUid(uid), required(date, "a date"), required(date, "a date")),
    enabled,
    retry: retryUnlessIntegrity,
  });
  return toRead(query, enabled);
};

/** The entries recorded on `from`..`to` inclusive — normally a plan's start and end. */
export const useNutritionV2EntriesRange = (
  from: NutritionDate | null | undefined,
  to: NutritionDate | null | undefined
): NutritionV2Read<RecordedEntry[]> => {
  const uid = useEligibleUid();
  const enabled = !!uid && isNutritionDate(from) && isNutritionDate(to) && from <= to;

  const query = useQuery({
    queryKey: queryKeys.nutrition.entries.range(uid, from ?? "", to ?? ""),
    queryFn: () => readNutritionV2Entries(requireUid(uid), required(from, "a start date"), required(to, "an end date")),
    enabled,
    retry: retryUnlessIntegrity,
  });
  return toRead(query, enabled);
};
