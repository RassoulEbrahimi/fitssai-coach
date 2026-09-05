/**
 * Code shared by the React client and the Firebase Functions backend.
 *
 * Everything under `shared/` must stay free of React, Firebase, Node and
 * browser APIs — it is compiled by both workspaces, so anything that only
 * exists in one of them breaks the other.
 */
export * from "./workoutPlan";
export * from "./weeklyRecommendation";
