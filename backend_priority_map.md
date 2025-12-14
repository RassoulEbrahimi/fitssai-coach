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
| 6 | **Unify Error Handling in Hooks** | Hook | **Medium** | M | **[DONE]** `useSupabaseAction` standardized across all hooks. | Create a standardized `useSupabaseAction` or middleware. (Completed in Mission 3/5) |
| 7 | **Lint Cleanup (160+ Errors)** | Codebase | **Low** | L | Lint errors reduced. Edge Functions are now strictly typed. | Incrementally strictly type the Edge Functions and Hooks. (Ongoing) |
| 8 | **Cache Invalidation Consistency** | Hook | **Medium** | M | **[DONE]** Centralized `queryKeys.ts` implemented. | Centralize invalidation logic in a "Mutation Manager" or query key factory. (Completed in Mission 5) |

## Next Missions (Top 3)

### Mission 5: Frontend Cache Architecture (Completed)
**Why:** UI updates were manually managed and prone to inconsistency (e.g., dashboard not updating after workout).
**Goal:** Implement a centralized `QueryKeyFactory` and automate cache invalidation.
**Status:** **Completed.**
**Achievements:**
- [x] Created `src/lib/queryKeys.ts` as the single source of truth for query keys.
- [x] Refactored `useWorkoutPlan`, `useWeekCompletion`, `useWorkoutLogs`, `useSetTracking` to use centralized keys.
- [x] Implemented cross-feature invalidation (e.g., `useSetTracking` invalidates `week-completion` on success).

### Mission 6: Polish & Lint Cleanup (Next Up)
**Why:** We have fixed the core architecture, but there are still ~129 lint errors and some minor loose ends in the codebase.
**Goal:** Run a strict lint check, fix remaining `any` types in the frontend, and ensure the build is 100% clean.
**Tasks:**
- [ ] Run `npm run lint` and analyze report.
- [ ] Fix remaining UI component lint errors.
- [ ] Ensure all Edge Functions are 100% type-safe.

### Mission 7: Offline-First Experience (Future)
**Why:** Users gym in basements with bad reception.
**Goal:** Verify `useOfflineQueue` handles all edge cases (retry logic, conflict resolution).

## Build/Test Notes
- **Architecture:** Frontend now uses a centralized Query Key Factory pattern.
- **Database:** Self-cleaning enabled via Cascade.
- **Security:** All Edge Functions strictly typed and secured.
