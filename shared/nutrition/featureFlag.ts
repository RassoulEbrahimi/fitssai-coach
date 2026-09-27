/**
 * Whether the Nutrition tab shows the V2 product UI.
 *
 * UI rollout only (NUT-12D). This grants no backend capability and does not
 * enable target policies or AI generation. False restores the legacy tab;
 * V2 loading, errors and empty data never fall back to legacy content.
 */
export const NUTRITION_V2_ENABLED: boolean = true;
