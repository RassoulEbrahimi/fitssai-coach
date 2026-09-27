/**
 * Nutrition V2 foundation: contracts, identities, dates, collection names, the
 * profile contract, the recorded-entry write planner, the target callable
 * contract and profile fingerprint, and the feature flag. Pure — no Firestore,
 * React, Node or browser APIs, and no clock (see `shared/index.ts`).
 */
export * from "./contracts";
export * from "./collections";
export * from "./dates";
export * from "./entryWrite";
export * from "./featureFlag";
export * from "./fingerprint";
export * from "./identity";
export * from "./profile";
export * from "./target";
