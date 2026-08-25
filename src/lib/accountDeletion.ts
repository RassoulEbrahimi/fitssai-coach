/**
 * Account-deletion support configuration.
 *
 * Phase 1 has no self-service deletion. The honest alternative is to point
 * people at support — but that is only honest if there is a real address to
 * write to and a real commitment about how long an answer takes. Neither
 * value has been supplied, so both are null and the entry point stays hidden
 * rather than shipping an invented address, a placeholder token, or a button
 * that leads nowhere.
 *
 * To enable: set both constants to the real, approved values. The button and
 * its copy appear automatically.
 */

/** Real support address, e.g. "support@example.com". Null until supplied. */
export const SUPPORT_EMAIL: string | null = null;

/**
 * Real, approved commitment on response time, e.g. "innerhalb von 14 Tagen".
 * Null until supplied.
 */
export const DELETION_RESPONSE_COMMITMENT: string | null = null;

const isSupplied = (value: string | null): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Both values are required: an address with no commitment, or a commitment
 * with no address, is not a usable support path.
 */
export const isDeletionSupportConfigured = (
  email: string | null = SUPPORT_EMAIL,
  commitment: string | null = DELETION_RESPONSE_COMMITMENT
): boolean => isSupplied(email) && isSupplied(commitment);
