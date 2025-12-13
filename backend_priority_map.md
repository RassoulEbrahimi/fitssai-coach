# Backend Health Scan & Priority Map

This document outlines the current state of the backend (Supabase Edge Functions, Database, RLS) and client-side integration logic. It provides a prioritized roadmap for stability, performance, and security improvements.

## Priority Map

| Rank | Title | Area | Impact | Effort | Description | Suggested Fix |
|------|-------|------|--------|--------|-------------|---------------|
| 1 | **Fix Auth Checks in Edge Functions** | Edge Function | **High** | S | `generate-plans` and others manually check auth or rely on passed-in user IDs in body without strict verification against the auth token in some paths. Admin check via `is_current_user_admin` is risky if not robust. | Ensure all functions strictly use `getUser()` from the auth token to derive `userId`. Remove reliance on `body.user_id` unless strictly admin-scoped and verified. |
| 2 | **Optimize `toggle-set` Round Trips** | Edge Function | **High** | M | **[DONE]** `toggle-set` now uses `rpc_toggle_set_and_count`. | Refactor into a single Postgres RPC `toggle_set_and_count`. (Completed in Mission 1) |
| 3 | **Harden `generate-plans` Error Handling** | Edge Function | **Medium** | S | Currently retuns 200 OK with `success: false` for logic errors, masking observability. Mock data fallback logic is complex and mixed with business logic. | Return proper 4xx/5xx status codes. Extract mock data generation into a separate utility or table. Ensure errors are logged to a monitoring table (like `ai_logs`). |
| 4 | **Fix `get-week-completion` Full Scan** | Edge Function | **Medium** | M | Fetches *all* logs for a week to build a completion map. As logs grow, this will slow down the dashboard load. | Use a specialized SQL query or RPC to group and aggregate completion status by day/exercise, returning only necessary booleans, not full log rows. |
| 5 | **Strict RLS for Deletion** | Database | **High** | S | `delete-account` manually deletes from multiple tables. If a new table is added (e.g. `audit_logs`) and not added here, we get orphaned data. | Ensure all tables with `user_id` have `ON DELETE CASCADE` foreign keys. Verify RLS policies are `DELETE USING (auth.uid() = user_id)`. |
| 6 | **Unify Error Handling in Hooks** | Hook | **Medium** | M | Hooks like `useWeekCompletion` and `useSetTracking` have custom error handling and different retry logic. Client usage of `toast` varies. | Create a standardized `useSupabaseAction` or middleware that allows consistently handling retries, error reporting, and toast feedback. |
| 7 | **Lint Cleanup (160+ Errors)** | Codebase | **Low** | L | 161 lint errors (mostly `any` types). Makes refactoring risky. | Incrementally strictly type the Edge Functions and Hooks. Start with `generate-plans` and `useSetTracking`. |
| 8 | **Cache Invalidation Consistency** | Hook | **Medium** | M | `useOfflineQueue` invalidates queries, but ensuring *all* relevant keys (`week-completion`, `workout-sets`, `workout-context`) are invalidated on every mutation is manual and error-prone. | Centralize invalidation logic in a "Mutation Manager" or query key factory to ensure related cache entries are always refreshed together. |

## Next Missions (Top 3)

### Mission 1: Optimize & Harden `toggle-set` (Completed)
**Why:** This is the most frequent user action during a workout. Latency here feels sluggish.
**Goal:** Replace the 4-step DB chatter in `toggle-set` with a single fast RPC.
**Status:** **Completed.** RPC `rpc_toggle_set_and_count` implemented. Edge function refactored to use it and strict auth.

### Mission 2: Refactor `generate-plans` for Robustness (Completed)
**Why:** Plan generation is the core "Magic" value prop. Improved stability was critical.
**Goal:** Clean up the function, split mock logic, and improve error observability.
**Status:** **Completed.** Refactored with proper auth, error codes, typed shared mocks, and Zod validation.
**Tasks:**
- [x] Extract mock generation to `_shared/mockUtils.ts`.
- [x] Standardize HTTP error codes (400 for input, 500 for AI/DB).
- [x] Ensure strict type safety.

### Mission 3: Dashboard Load Performance (`get-week-completion`) (Completed)
**Why:** The dashboard is the landing page. Fetching all raw logs just to show checkmarks is inefficient.
**Goal:** Optimize `get-week-completion` to return a lightweight bitmap or simplified JSON.
**Status:** **Completed.** Implemented `get_weekly_completion_map` RPC and refactored Edge Function.

## Future Roadmap (Refactoring Candidates)
The following hooks should be refactored to use `useSupabaseAction` for consistent error handling and offline support:
- `src/hooks/useSetTracking.tsx` (Critical - Workout usage)
- `src/hooks/queries/useWorkoutLogs.ts` (Critical - Dashboard usage)
- `src/hooks/useAddExercise.tsx`
- `src/hooks/useDeleteExercise.tsx`
- `src/hooks/useExerciseEditor.tsx`
- `src/hooks/useRestoreExercise.tsx`

## Build/Test Notes
- **Lint:** `npm run lint` failed with 161 problems. Most are `no-explicit-any` in Edge Functions (`update-exercise`, `generate-plans`).
- **Tests:** No unit tests found for Edge Functions. `npm run test` was not run (not configured standardly or skipped to save analysis time).
- **TypeScript:** High usage of `any` in older functions (`update-exercise`) makes them risky to touch without adding types first.
