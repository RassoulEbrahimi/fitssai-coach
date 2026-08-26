# Backend state & priority map

Last verified against `main` during Phase 2 / PR46.

## Runtime today

FitssAI is a **client-only** application. There is no server-side execution
layer of any kind.

| Concern | State |
| --- | --- |
| Auth | Firebase Auth, client SDK |
| Data | Cloud Firestore, client SDK |
| Hosting | GitHub Pages (static), via `.github/workflows/deploy.yml` |
| Cloud Functions | **None.** No `functions/`, no `firebase.json`, no `.firebaserc` |
| Firestore rules | **Not in version control.** They exist only in the Firebase console |
| Supabase / Postgres | **Retired.** Not a dependency; all remaining code removed in PR46 |
| AI provider | **None.** No provider SDK, no API key, no generation anywhere |
| Telemetry | `src/lib/telemetryClient.ts` — `console.log` only, no backend |

### What is *not* true, despite older notes

An earlier version of this file described row-level security, an AI plan
generator and `ai_logs` monitoring as complete. To be explicit:

- **`ai_logs` is never written.** `useAIAnalytics` and `useAISessions` read
  `users/{uid}/ai_logs`, but no code in this repository writes to it, so
  `AIAnalyticsCard` reports zeros by construction. Making that surface honest
  is outstanding work.
- **No plan is generated.** `useWorkoutPlan.generatePlan` throws
  `AI_UNAVAILABLE` and shows a German notice. It is a stub, not an integration.
- **Nutrition plans are read-only.** There is no generator for them, and
  nutrition generation is out of scope for Phase 2.
- "Strictly typed and clean" was inaccurate: `npm run lint` reports a
  pre-existing error backlog. The typecheck gate (PR44) and test gate (PR45)
  are real and enforced in CI.

## Completed foundations

Caching, offline queue, bundle splitting, PWA install, theme system, plan
lifecycle, accessibility baseline, i18n (German-only), a real `tsc` gate and a
real `vitest` gate are all in place and enforced by `deploy.yml`.

## Phase 2 — outstanding

Ordered by dependency, not by value:

1. **Backend execution layer.** Cloud Functions require the Firebase **Blaze**
   plan. This is a billing decision and it blocks everything below.
   `src/pages/AdminPanel.tsx` already disables two features for this reason.
2. **Firestore rules into version control**, reviewed before any server
   function trusts a `role` field.
3. **Shared plan validation** (zod is already a dependency) so generated
   content can never be persisted unvalidated.
4. **Session duration persistence** — `endSession` currently discards it, so
   no historical workout time exists.
5. **Deterministic coaching/review engine** before any model is involved.
6. Only then: AI generation, summaries, and a real notification source
   (`src/lib/notifications.ts` is the seam and returns `[]` today).

No AI provider has been selected, and none should be assumed. Any provider key
must live in server-side config — **never** in a `VITE_*` variable, which is
inlined into the public bundle at build time.
