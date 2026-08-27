/**
 * Server-authoritative quota for expensive coaching actions.
 *
 * The browser is never asked how much quota a user has left. It cannot be:
 * the answer decides whether money is spent, and anything the client sends can
 * be edited before it is sent. Every function here takes the uid the auth
 * guard resolved from a verified token, never one from a request payload.
 *
 * No Firestore write happens yet. Persisting counters before a single
 * chargeable action exists would create a production collection whose only
 * content is zeroes — see docs/dev/firebase-backend.md. PR51 supplies a
 * persistent store through the `QuotaStore` seam below.
 */

/** Actions that will cost money once a provider exists. */
export const QUOTA_ACTIONS = ["plan_generation", "weekly_summary"] as const;

export type QuotaAction = (typeof QUOTA_ACTIONS)[number];

export interface QuotaDecision {
  allowed: boolean;
  action: QuotaAction;
  /** Calls already spent in the current period. */
  used: number;
  /** Calls permitted in the period. */
  limit: number;
  /** Never negative. */
  remaining: number;
  /** Machine-readable reason when `allowed` is false. */
  reason?: "limit_reached";
}

/**
 * The product policy: three successful plan generations per user per calendar
 * month. A generation is a real provider call against a paid model, so this is
 * a cost control, and it is enforced on the server because the browser is not
 * a place to keep one.
 *
 * `weekly_summary` has no implementation yet; its limit exists so the type is
 * total, not because anything counts against it.
 */
export const DEFAULT_QUOTA_LIMITS: Readonly<Record<QuotaAction, number>> = Object.freeze({
  plan_generation: 3,
  weekly_summary: 8,
});

/**
 * Where usage counts come from.
 *
 * Deliberately tiny: an implementation needs only to count and to increment.
 * PR51 backs this with Firestore; tests back it with a map, and neither the
 * caller nor these rules change.
 */
export interface QuotaStore {
  getUsage(uid: string, action: QuotaAction): Promise<number>;
  increment(uid: string, action: QuotaAction): Promise<void>;
}

/**
 * A store that records nothing.
 *
 * Used until a chargeable action exists. It reports zero usage — which is
 * true, because nothing has been spent — and refuses to pretend an increment
 * happened, so a caller that starts charging against it fails a test rather
 * than silently granting unlimited calls in production.
 */
export const createNullQuotaStore = (): QuotaStore => ({
  getUsage: async () => 0,
  increment: async () => {
    throw new Error(
      "No quota store is configured. A chargeable action must not run without one."
    );
  },
});

export interface QuotaServiceOptions {
  store?: QuotaStore;
  limits?: Readonly<Record<QuotaAction, number>>;
}

export interface QuotaService {
  check(uid: string, action: QuotaAction): Promise<QuotaDecision>;
  consume(uid: string, action: QuotaAction): Promise<QuotaDecision>;
}

export const createQuotaService = (options: QuotaServiceOptions = {}): QuotaService => {
  const store = options.store ?? createNullQuotaStore();
  const limits = options.limits ?? DEFAULT_QUOTA_LIMITS;

  const decide = (action: QuotaAction, used: number): QuotaDecision => {
    const limit = limits[action];
    const remaining = Math.max(0, limit - used);
    return {
      allowed: used < limit,
      action,
      used,
      limit,
      remaining,
      ...(used < limit ? {} : { reason: "limit_reached" as const }),
    };
  };

  const requireUid = (uid: string): string => {
    // The caller passes the uid the auth guard produced. An empty one means a
    // code path reached here without authenticating, which must not be
    // charged to "everybody".
    if (typeof uid !== "string" || uid.trim() === "") {
      throw new Error("Quota requires an authenticated uid.");
    }
    return uid;
  };

  return {
    check: async (uid, action) => decide(action, await store.getUsage(requireUid(uid), action)),

    consume: async (uid, action) => {
      const safeUid = requireUid(uid);
      const decision = decide(action, await store.getUsage(safeUid, action));
      if (!decision.allowed) return decision;

      await store.increment(safeUid, action);
      return decide(action, decision.used + 1);
    },
  };
};
