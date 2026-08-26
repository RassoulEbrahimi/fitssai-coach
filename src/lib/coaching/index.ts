/**
 * The deterministic coaching layer.
 *
 * Pure functions over plain data: no Firebase, no React, no clock, no network,
 * and no AI provider. Numbers are computed here; a later AI layer may explain
 * them, but must never produce one.
 */
export * from "./fitnessGoal";
export * from "./facts";
export * from "./suggestions";
export * from "./sessionSummary";
export * from "./present";
