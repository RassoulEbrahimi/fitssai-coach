/**
 * Whether Nutrition V2 is switched on.
 *
 * Off. While it is, no V2 route or screen is reachable and legacy Nutrition is
 * what people see. It moves only when the V2 experience behind it ships — the
 * same rule `BACKEND_CAPABILITIES` follows for the backend.
 */
export const NUTRITION_V2_ENABLED: boolean = false;
