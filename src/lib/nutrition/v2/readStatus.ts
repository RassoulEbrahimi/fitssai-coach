import type { NutritionEligibilityReason } from "@shared/nutrition";

/**
 * Who may read Nutrition V2 right now. Reads run only for `eligible`: a
 * signed-in adult (NUT-03 eligibility). Everything else reads nothing.
 */
export type NutritionV2Access =
  | { status: "signedOut" }
  /** The profile — and so the age — is still loading. */
  | { status: "pending" }
  /** The profile could not be read, so eligibility is unknown. */
  | { status: "error" }
  | { status: "ineligible"; reason: Exclude<NutritionEligibilityReason, "eligible"> }
  | { status: "eligible"; uid: string };

/**
 * One Nutrition V2 read, as the UI may use it. `disabled` means no read was
 * allowed to run (signed out, not eligible, or an input is missing) — never
 * "empty".
 */
export type NutritionV2Read<T> =
  | { status: "disabled" }
  | { status: "pending" }
  | { status: "error"; error: unknown }
  | { status: "success"; data: T };
