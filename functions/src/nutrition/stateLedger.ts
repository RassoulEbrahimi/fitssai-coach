import {
  NUTRITION_STATE_REQUEST_LEDGER_SIZE,
  type NutritionStateRequest,
} from "../../../shared/nutrition";

/**
 * The account state's one request ledger (`recentRequests`), shared by every
 * state-changing operation — `setTarget` (NUT-08) and `repeatPlan` (NUT-09).
 * There is no second ledger.
 */

/**
 * Appends `request` and evicts the oldest records beyond the ledger size,
 * whatever their operation. Deterministic; `ledger` is not changed.
 */
export const appendNutritionStateRequest = (
  ledger: readonly NutritionStateRequest[],
  request: NutritionStateRequest
): NutritionStateRequest[] => [...ledger, request].slice(-NUTRITION_STATE_REQUEST_LEDGER_SIZE);
