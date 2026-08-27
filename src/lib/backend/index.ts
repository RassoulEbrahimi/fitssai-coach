import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { FUNCTIONS_REGION } from "./region";

/**
 * The client's side of the callable boundary.
 *
 * Deliberately a seam and not a feature. Nothing in the app calls this on
 * render, on mount, or on a timer — a status probe that fires on every screen
 * would be a network request per user per view, paid for, to learn something
 * that does not change. It exists so PR51 has a tested path to extend, and so
 * a developer can confirm the backend is reachable.
 *
 * No secret lives here. The callable is authorised by the signed-in user's own
 * Firebase ID token, which the SDK attaches; the server decides what that
 * identity is allowed to do.
 */

export interface BackendCapabilities {
  planGeneration: boolean;
  weeklySummaryAI: boolean;
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
