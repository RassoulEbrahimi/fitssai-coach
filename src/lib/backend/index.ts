import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { FUNCTIONS_REGION } from "./region";

/**
 * The client's side of the callable boundary.
 *
 * A seam, with one caller: `useCoachBackendCapabilities` (NUT-14), which asks
 * once per signed-in account and session whether the DEPLOYED backend offers
 * the Nutrition target and generation actions. Nothing calls it per render,
 * per view or on a timer — a status probe that fires on every screen would be
 * a network request per user per view, to learn something that changes only
 * with a deployment. An explicit Nutrition refresh may ask again.
 *
 * No secret lives here. The callable is authorised by the signed-in user's own
 * Firebase ID token, which the SDK attaches; the server decides what that
 * identity is allowed to do.
 */

export interface BackendCapabilities {
  planGeneration: boolean;
  weeklySummaryAI: boolean;
  /** The deployed backend offers Nutrition target setup (NUT-14). */
  nutritionTargets: boolean;
  /** The deployed backend offers Nutrition plan generation (NUT-14). */
  nutritionGeneration: boolean;
}

export interface CoachBackendStatus {
  ok: true;
  backend: string;
  region: string;
  uid: string;
  capabilities: BackendCapabilities;
}

/**
 * Ask the backend whether it is reachable and what it can do.
 *
 * Rejects when the user is not signed in — the server refuses an
 * unauthenticated call, and that refusal is the point of the probe.
 */
export const fetchCoachBackendStatus = async (): Promise<CoachBackendStatus> => {
  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const callable = httpsCallable<undefined, CoachBackendStatus>(functions, "coachBackendStatus");
  const result = await callable();
  return result.data;
};
