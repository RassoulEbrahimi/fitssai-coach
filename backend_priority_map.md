# Backend Health Scan & Priority Map

This document outlines the current state of the backend (Supabase Edge Functions, Database, RLS) and client-side integration logic. It provides a prioritized roadmap for stability, performance, and security improvements.

## Priority Map

| Rank | Title | Area | Impact | Effort | Description | Suggested Fix |
|------|-------|------|--------|--------|-------------|---------------|
| 1 | **Fix Auth Checks in Edge Functions** | Edge Function | **High** | S | **[DONE]** All functions now strictly use `getUser()`. | Ensure all functions strictly use `getUser()` from the auth token. (Completed in Mission 4) |
| 2 | **Optimize `toggle-set` Round Trips** | Edge Function | **High** | M | **[DONE]** `toggle-set` now uses `rpc_toggle_set_and_count`. | Refactor into a single Postgres RPC `toggle_set_and_count`. (Completed in Mission 1) |
| 3 | **Harden `generate-plans` Error Handling** | Edge Function | **Medium** | S | **[DONE]** Refactored with 4xx/5xx codes & mock utils. | Return proper 4xx/5xx status codes. Extract mock data generation. (Completed in Mission 2) |
| 4 | **Fix `get-week-completion` Full Scan** | Edge Function | **Medium** | M | **[DONE]** Uses specialized RPC `get_weekly_completion_map`. | Use a specialized SQL query or RPC to group and aggregate completion status. (Completed in Mission 3) |
| 5 | **Strict RLS for Deletion** | Database | **High** | S | **[DONE]** All tables now have `ON DELETE CASCADE`. | Ensure all tables with `user_id` have `ON DELETE CASCADE` foreign keys. (Completed in Mission 4) |
| 6 | **Unify Error Handling in Hooks** | Hook | **Medium** | M | Hooks like `useWeekCompletion` have custom handling. | Create a standardized `useSupabaseAction` or middleware. (Mostly Completed in Mission 3) |
| 7 | **Lint Cleanup (160+ Errors)** | Codebase | **Low** | L | Lint errors reduced. Edge Functions are now strictly typed. | Incrementally strictly type the Edge Functions and Hooks. (Major progress in Mission 4) |
| 8 | **Cache Invalidation Consistency** | Hook | **Medium** | M | Ensuring *all* relevant keys are invalidated on every mutation is manual. | Centralize invalidation logic in a "Mutation Manager" or query key factory to ensure related cache entries are always refreshed together. |

## Next Missions (Top 3)

### Mission 4: Security Hardening & Data Integrity (Completed)
**Why:** Data integrity was at risk (orphaned logs) and some functions lacked strict typing/standardization.
**Goal:** Enforce `ON DELETE CASCADE` in DB and standardize/secure all remaining Edge Functions.
**Status:** **Completed.**
**Achievements:**
- [x] Database: Applied `ON DELETE CASCADE` to all user-linked tables (`workout_logs`, `ai_logs`, etc.). Orphaned data cleaned.
- [x] `delete-account`: Refactored to use `auth.admin.deleteUser` and rely on DB cascade.
- [x] `admin-fetch`: Secured with `is_current_user_admin` RPC check.
- [x] Edge Functions: `update-exercise`, `toggle-exercise`, `get-daily-quote` standardized and strictly typed (removed `any`).

### Mission 5: Frontend Cache Architecture (Next Up)
**Why:** UI updates are manually managed. Toggling a set might not immediately update the weekly progress bar without a refresh or complex manual invalidation.
**Goal:** Implement a centralized `QueryKeyFactory` and `MutationManager` to automate cache invalidation.
**Tasks:**
- [ ] Audit current query keys in hooks.
- [ ] Create `src/lib/queryKeys.ts`.
- [ ] Refactor hooks to use centralized keys.
- [ ] Create a `MutationManager` or helper for consistent invalidation.

## Future Roadmap (Refactoring Candidates)
The following hooks have been refactored to use `useSupabaseAction`:
- [x] `src/hooks/useSetTracking.tsx`
- [x] `src/hooks/useWeekCompletion.tsx`
- [x] `src/hooks/queries/useWorkoutLogs.ts`
- [x] `src/hooks/useAddExercise.tsx`
- [x] `src/hooks/useDeleteExercise.tsx`
- [x] `src/hooks/useExerciseEditor.tsx`
- [x] `src/hooks/useRestoreExercise.tsx`

## Build/Test Notes
- **Lint:** Edge Functions are now strictly typed (no implicit `any`).
- **Database:** Self-cleaning enabled via Cascade.
