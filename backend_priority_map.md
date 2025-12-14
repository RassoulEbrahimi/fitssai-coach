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
| 7 | **Lint Cleanup (160+ Errors)** | Codebase | **Low** | L | **[DONE]** Critical lint errors fixed. Build passes. | Incrementally strictly type the Edge Functions and Hooks. (Completed in Mission 6) |
| 8 | **Cache Invalidation Consistency** | Hook | **Medium** | M | **[DONE]** Centralized `queryKeys.ts` implemented. | Centralize invalidation logic in a "Mutation Manager" or query key factory. (Completed in Mission 5) |

## Completed Missions Log

### Mission 1-3: Performance & Stability (Completed)
- **Toggle Set:** Optimized with RPC.
- **Plan Generation:** Hardened and secured.
- **Dashboard Load:** Optimized with specialized SQL/RPC.

### Mission 4: Security Hardening (Completed)
- **DB:** `ON DELETE CASCADE` applied to all tables.
- **Edge Functions:** Secured `delete-account`, `admin-fetch` and others.

### Mission 5: Frontend Cache Architecture (Completed)
- **Architecture:** Implemented `src/lib/queryKeys.ts`.
- **Consistency:** Solved dashboard sync issues.

### Mission 6: Polish & Lint Cleanup (Completed)
**Goal:** Run a strict lint check, fix remaining `any` types, and ensure clean build.
**Status:** **Completed.**
**Achievements:**
- [x] UI Type Safety: Fixed `any` in `AuthPage`, `DashboardPage`, `HomeView`.
- [x] Hook Hardening: Added explicit return types to `useWorkoutPlan`, `useWorkoutLogs`.
- [x] Centralized Types: Moved shared types to `src/lib/types.ts`.
- [x] Verification: `npm run build` passed successfully.

## Next Missions (Top 3)

### Mission 7: Offline-First Experience (Completed)
**Goal:** Verify `useOfflineQueue` handles all edge cases and UI shows proper "Offline" indicators.
**Status:** **Completed.**
**Achievements:**
- [x] **Offline Logic:** Refactored `offlineHandlers.ts` with strict types and centralized `queryKeys`.
- [x] **UI Indicators:** Implemented lightweight `OfflineBanner.tsx` in Dashboard.
- [x] **Verification:** Verified "Airplane Mode" behavior.

## Next Missions (Top 3)

### Mission 8: Initial Load Performance (Next Up)
**Why:** Dashboard takes a moment to render on slow devices.
**Goal:** Implement route splitting and optimize initial data fetch waterfall.
**Tasks:**
- [ ] Analyze bundle size with `rollup-plugin-visualizer` (optional manual check).
- [ ] Validate `lazy` loading of specific heavy views (Charts?).
- [ ] Optimize critical path queries.

## Build/Test Notes
- **Build:** `npm run build` is passing (Verified in Mission 6).
- **Lint:** Codebase is significantly cleaner and strictly typed.
