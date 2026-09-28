# NUT-12D — Nutrition V2 product UI rollout

Base: `main` at `1a508b1` (PR #122). One reviewable slice is sufficient:
mount the existing V2 experience, expose read-only generation status and
refresh, and test the real Dashboard boundary. No backend policy or provider
configuration is needed to render the UI.

## What ships

- `NUTRITION_V2_ENABLED = true` selects a separate lazy V2 view in Dashboard.
  False restores the legacy tab for rollback. Loading, errors, ineligibility
  and empty V2 data never select legacy as a fallback.
- Signed-in adults see the current target, Today meals, recorded state and
  the owning plan's seven dates when valid V2 documents exist. Berlin dates,
  predecessor/successor ownership, planned/target/recorded distinctions,
  immutable snapshots, strict reads and offline entry reconciliation retain
  their existing implementations.
- No state document shows “Ernährung ist noch nicht eingerichtet”. A state
  without an active plan shows “Kein aktiver Ernährungsplan”. Neither creates
  a state, target or plan. Missing age and minors retain eligibility messages
  and issue no V2 reads. Account changes remount the V2 root.
- “Aktualisieren” retries only this account's V2 queries (or its profile when
  eligibility could not be read). It never invokes generation or target setup.
- The active generation pointer is read using the existing strict, ephemeral
  request query. Queued/running/succeeded/failed/discarded, loading, missing
  and error states are distinct. Refresh or normal query focus/remount refetch
  updates status; there is no background polling or new request action.
- Target setup is hidden in the product root, including for stale targets.
  Its existing component remains available to explicit controlled tests.
  Existing plan recording and base-meal replacement/undo remain available.
- Legacy Home/Profile references remain explicitly legacy and unchanged.
  The V2 view accepts no legacy props and imports no legacy model.

## NUT-12D.1 — profile completion and empty state

- A Nutrition profile card completes or changes the Nutrition answers of the
  existing profile document: age, height, weight, fitness goal, dietary
  preference (shared with onboarding), biological sex, activity level and
  meals per day. It reads and saves only through `useProfile` /
  `useUpdateProfile`, prefills every recognised answer and writes only the
  answers that changed. Numbers use onboarding's bounds
  (`src/lib/profileMeasurements.ts`); choices use the NUT-03 vocabularies.
  Emptying an answered field is refused; nothing is defaulted or inferred.
- Completeness (`src/lib/nutrition/v2/profileCompletion.ts`) covers exactly
  those eight answers; the target mode and a manual kcal target are not part
  of it. Missing and unrecognised stored values are reported separately.
- The card is offered to eligible and ineligible accounts. Without an age it
  replaces the ineligibility message; saving an adult age updates the profile
  cache, and only then do Nutrition V2 reads start. A minor keeps the
  ineligibility message and can still correct the answers; no V2 read runs.
- Without a target or plan the card is the whole empty state; the separate
  “not set up”/“no plan”, empty-target and availability messages are gone.
  Planstatus renders only when the state names a generation request.
  Refresh is a compact icon in the Nutrition card header, same scope as before.

## Production gates and remaining work

Unchanged by NUT-12D: `NUTRITION_AI_PRODUCTION_ENABLED = false`, backend
`nutritionGeneration = false`, `nutritionTargets = false`, and — at that
time — unsigned target and validation policies and no production Vertex
deployment (both since configured; see the updates below). No provider
timeout/retry/lease settings, Firebase rules, schema, quota or server write
paths change in that PR.

A fresh account can see the real empty V2 UI after deployment. It cannot get
its first target or AI meal plan from this release. Existing legacy plans
are not V2 plans and are not migrated or substituted. Do not seed test
fixtures into production to make the page look populated.

Update (NUT-12C.1): the deterministic TargetPolicy v1 (`calculated-target`,
`manual-target`), PlanValidationPolicy v1 (`target-alignment`) and initial
slot mapping v1 are now signed and configured server-side, so a fresh adult
account can set its first TARGET. The target setup shows the new
`TARGET_INFEASIBLE` refusal neutrally. Production AI is still off:
`NUTRITION_AI_PRODUCTION_ENABLED = false`, and both capability flags remain
`false` (at NUT-12C.1 there was also no Vertex deployment and no Nutrition
quota yet).

Update (NUT-12C.2): the generation backend is now configured behind the
closed gate — the signed Vertex deployment (project `fitssai-coach`, location
`eu`, `gemini-3.8-flash` as Nutrition's own model pin, thinking `LOW`, 8192
output tokens, 45 s per attempt, 2 transport attempts, 300 s operation
lease), the execution budget (`nutritionRequestPlan` Function timeout 240 s,
browser callable timeout 300 s for this callable only), the
`nutrition_plan_generation` quota (4 activated plans per user per UTC month,
first plans and regenerations alike, never Training's allowance) and an
explicit Keto refusal (`DIETARY_PREFERENCE_NOT_SUPPORTED`; `keto` stays in the
profile vocabulary). Still: `NUTRITION_AI_PRODUCTION_ENABLED = false`, both
capability flags `false`, and no production Nutrition AI call can occur. The
new refusal codes `QUOTA_EXCEEDED` and `DIETARY_PREFERENCE_NOT_SUPPORTED`
reach the browser's callable parser; no UI action issues a request yet, so no
copy was added. The runtime identity's Vertex AI permission (IAM) and the
privacy, legal and data-processing sign-off remain open prerequisites; this
repository changes neither.

Remaining sequence:

1. NUT-12C: sign off policies (done in NUT-12C.1) and production
   configuration, including the timeout/retry/lease relationship (done in
   NUT-12C.2). This is not required for read-only UI.
2. NUT-13: authenticated browser/phone E2E against an approved environment,
   including recording and replacement with real server responses. Next.
3. NUT-14: separately reviewed production enablement and explicit setup/
   generation actions — the only slice that may turn on the gate and the
   capability flags, after the IAM prerequisite and the privacy/legal sign-off.
   UI rollout does not authorize enabling these gates.

## One-time deployment and phone check (after review/merge)

This PR is not merged or deployed by its authoring task.

1. From the reviewed merged checkout, ensure current rules are deployed:
   `firebase deploy --only firestore:rules --project fitssai-coach`.
   GitHub Pages does **not** deploy rules or Functions. If the production rules
   already match this checkout, no rules change is necessary. Outdated rules
   may show an explicit read error even for an empty account.
2. If existing V2 users will use base-meal replacement/undo and its callable
   is not yet deployed, build Functions and deploy only that callable:
   `npm --prefix functions ci`, `npm run build:functions`, then
   `firebase deploy --only functions:nutritionUpdateSlot --project fitssai-coach`.
   Viewing the UI and recording entries do not require a new AI Function
   deployment. Do not enable AI or target policies for this UI rollout.
3. Merge the reviewed PR, then wait for **Deploy to GitHub Pages** on `main`:
   client build, backend tests and rules tests must pass before deploy. PR
   checks build artifacts but do not publish a phone preview.
4. Open `https://rassoulebrahimi.github.io/fitssai-coach/#/nutrition` on the
   phone while online, with an existing adult account. Check the app's build
   identifier matches the new deployment. If the installed PWA still shows
   the old build, close/reopen it and reload after the worker update. Avoid
   clearing site data while offline writes are pending.
5. For a fresh account, expect one empty state: “Ernährungsprofil
   vervollständigen” with “Angaben ergänzen” while answers are missing, or
   “Dein Ernährungsprofil ist vollständig.” once they are all given (NUT-12D.1).
   No empty target section, no Planstatus without a request, no legacy plan
   and no generation/target button. For an approved existing V2 account, check target,
   Today meals, recorded state and the seven-date week. Confirm refresh works.
6. Check minor/missing-age messaging and switching accounts. Test a recorded
   meal, offline reconciliation and replacement only on an approved test
   account with a valid V2 plan. A future-only plan shows its week and no
   recording controls for today, as before.

Rollback: set only `NUTRITION_V2_ENABLED` to false and redeploy the frontend.
Do not remove V2 documents, queued entry intents or deployed rules.

## Validation

- Real Dashboard integration tests use the actual V2 view/container, strict
  reads and derived models with synthetic Firestore responses. Cover empty,
  populated target/meals/week/recording, profile loading, ineligibility,
  corrupt-data retry, account change and generation status refresh.
- Legacy rollback tests explicitly set the rollout flag false. Existing V2
  ownership, recording, replacement, queue, integrity and server-gate tests
  stay in place; only assertions requiring the UI to be unreachable change.
- Local browser checks use synthetic data, no production Firebase, at 390px
  and 320px widths: target, Today/week, recording dialog, empty, error and
  ineligible states. This is visual QA, not authenticated production E2E.
