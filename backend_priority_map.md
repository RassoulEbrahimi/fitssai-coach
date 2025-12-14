# Backend Health Scan & Priority Map

This document outlines the state of the backend and frontend architecture.

## Priority Map

| Rank | Title | Area | Impact | Status | Description |
|------|-------|------|--------|--------|-------------|
| 1-7 | **Core Refactoring** | All | **High** | **[DONE]** | Missions 1-7 complete (Security, RLS, Caching, Offline). |
| 8 | **Mobile Performance** | Perf | **High** | **[DONE]** | Bundle split (~160KB entry), Lazy loading, Render optimized. (Mission 8) |
| 9 | **PWA & Installability** | UX | **High** | **[TODO]** | Make app installable with Manifest, Icons, Service Worker. |

## Completed Missions Log

### Mission 5: Frontend Cache Architecture (Completed)
- **Status:** **Completed.** Centralized `queryKeys.ts` and automated invalidation.

### Mission 6: Polish & Lint Cleanup (Completed)
- **Status:** **Completed.** Codebase strictly typed and clean.

### Mission 7: Offline-First Experience (Completed)
- **Status:** **Completed.** Offline Banner & Queue Handlers implemented.

### Mission 8: Mobile Performance Improvements (Completed)
**Goal:** Fix slow loading and low FPS on mobile.
**Status:** **Completed.**
**Achievements:**
- [x] **Bundle Diet:** Main entry reduced from ~900KB to 162KB (82% smaller).
- [x] **Code Splitting:** Implemented `manualChunks` (Vendor, React, UI, Supabase).
- [x] **Runtime Fix:** Fixed "Ticking Timebomb" in `TrainingContext`; `WorkoutView` no longer re-renders every second.
- [x] **Lazy Loading:** All routes are now loaded on demand.

## Next Missions (Top 3)

### Mission 9: PWA & Installability (Next Up)
**Why:** Users want an "App-like" experience without opening the browser bar every time.
**Goal:** Make the app installable (Add to Home Screen) with a valid Manifest and Service Worker.
**Tasks:**
- [ ] Configure `vite-plugin-pwa`.
- [ ] Generate standard icons (192, 512).
- [ ] Create `manifest.json` (Name, Colors, Display: standalone).
- [ ] Add "Install App" button to Profile or Settings.

## Build/Test Notes
- **Performance:** `npm run build` chunks are optimized.
- **Build:** Passing successfully.
