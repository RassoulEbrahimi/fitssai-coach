# NUT-14 — Nutrition V2 production enablement

NUT-14 is the separately reviewed slice that enables Nutrition V2 TARGET
setup and AI plan generation in production. It is the only slice that moves
the backend AI gate and the two Nutrition capability flags.

## NUT-14 production status — ACTIVE

Production enablement completed: **2026-09-29**. Production smoke:
**PASSED**.

| Step | Status |
| --- | --- |
| Phase 1 — merge | Done. PR #130 merged as `00202ffe3d745ce3c02f984fde02840add2e661f`; the GitHub Pages deployment for that merge succeeded. |
| Phase 2 — targeted backend deploy | Done. `nutritionRequestPlan` and `coachBackendStatus` (both `europe-west3`) deployed with the documented command. No other Function was deployed. |
| Phase 3 — production smoke | **PASSED** on 2026-09-29 with one approved adult account. See [Production smoke result](#production-smoke-result-passed-2026-09-29). |

Live production state:

| | Value |
| --- | --- |
| `NUTRITION_AI_PRODUCTION_ENABLED` | `true` |
| `nutritionTargets` | `true` |
| `nutritionGeneration` | `true` |
| `NUTRITION_V2_ENABLED` (frontend) | `true` |

The production configuration is frozen as reviewed:
- project `fitssai-coach`, Vertex location `eu`, model `gemini-3.8-flash`;
- thinking `LOW`, `maxOutputTokens` 8192;
- provider timeout 45 s, 2 transport attempts, retry on 429/5xx only, one repair;
- Function timeout 240 s, lease 300 s, browser timeout 300 s;
- 256 MiB, `maxInstances` 5;
- quota 4 successful Nutrition plans per user per UTC month;
- policies, slots, the generation lifecycle and recording/replacement semantics.

The rollout closed with the non-blocking follow-ups listed under
[Open follow-ups](#open-follow-ups-non-blocking).

The sections from "Pre-flight" to "Production smoke plan" are the historical
pre-merge procedure, kept for the release-order rationale and the rollback
design. They were written while the PR changed source only and deployed
nothing.

## What changes

| Where | Before | After (NUT-14) |
| --- | --- | --- |
| `functions/src/nutrition/aiGate.ts` | `NUTRITION_AI_PRODUCTION_ENABLED = false` | `true`, still a reviewed literal. No env var, Firebase parameter, feature-flag service, `NODE_ENV`, emulator or test-runner check can move it. |
| `functions/src/config.ts` `BACKEND_CAPABILITIES` | `nutritionTargets: false`, `nutritionGeneration: false` | both `true`. `planGeneration` and `weeklySummaryAI` (Training) are unchanged. |
| Browser | `fetchCoachBackendStatus` had no caller; `allowSetup` was never passed; `useNutritionV2RequestPlan` had no UI | The live `coachBackendStatus` gates the existing target setup and one explicit generation action. |

Unchanged:
- the model, Vertex project and location, and thinking and token settings;
- the transport timeout, retries, repair, lease and Function budget;
- quota, policies, slot mapping, schemas and Firestore rules;
- Training and legacy Nutrition.

`nutritionSetTarget`'s server behaviour is unchanged.

## Capability gating in the browser

The browser offers a new action only when the backend that is actually
**deployed** says it can do it. Having the action in the frontend bundle is
not enough.

- `useCoachBackendCapabilities` (`src/hooks/queries/useCoachBackendCapabilities.ts`)
  wraps `fetchCoachBackendStatus()`. It is the only caller.
- Only a signed-in, eligible adult asks. The key is
  `queryKeys.backend.status(uid)`.
- The status is read once per account and in-memory session:
  - `staleTime` and `gcTime` are `Infinity`;
  - no refetch on mount, focus or reconnect;
  - no retry, no polling, no timer.
- It fails closed. All of these hide the two new actions:
  - pending;
  - an error;
  - an answer for another uid;
  - a malformed answer;
  - any value but a literal `true`.
- A failed status read hides only the two new actions. Existing Nutrition keeps working:
  - the target, Today and Week;
  - recording, replacement and undo;
  - profile completion and refresh.
- The status is **never persisted**. `queryKeys.backend.all(uid)` is an
  ephemeral family in `src/lib/queryPersistence.ts`, next to generation
  requests and suggestions:
  - it is never dehydrated;
  - on restore, `removeRestoredEphemeralQueries` drops any ephemeral query
    that a stored snapshot still holds.
  So a stored `true` cannot outlive a backend rollback.
- Each account has its own query client (`QueryProvider` is keyed by uid)
  and the key carries the uid. Account B never sees A's status or A's
  generation outcome.
- **Aktualisieren** stays read-only. It invalidates this account's Nutrition
  reads and its backend status. It never sets a target, generates a plan,
  replays a request or creates a request id.

## Product flow

| Situation | Shown |
| --- | --- |
| Signed out, minor, missing age | No status read, no target setup, no generation. |
| Profile incomplete | Profile completion only. |
| Profile complete, no target, `nutritionTargets` false/pending/error | The existing "ready" message ("… sobald diese Funktion verfügbar ist"). No action. |
| Profile complete, no target, `nutritionTargets` true | "Als Nächstes legst du dein Ernährungsziel fest." and the existing target card's **Ziel festlegen**. No generation. |
| Target exists | The target card. With `nutritionTargets` true: **Ziel ändern**. |
| Target stale or not comparable | The existing freshness notice; with `nutritionTargets` true, **Ziel prüfen**. With generation available: "Prüfe zuerst dein Ernährungsziel …" and no generation action. |
| Fresh target, no plan, `nutritionGeneration` true | **Ernährungsplan erstellen**. |
| Fresh target, active plan that owns today, `nutritionGeneration` true | **Neuen Plan erstellen**. It asks once more before sending: the new plan starts tomorrow and uses one of the month's plans. |
| Active plan starts tomorrow or later | No regeneration (the server would answer `PLAN_NOT_REGENERABLE`). |
| Keto | "Für die Ernährungsform Keto können derzeit keine Ernährungspläne erstellt werden." No action and no substitute diet. |
| Queued/running request | The generation status, which says to refresh later. No second action. |
| Offline | The action is disabled and says a connection is needed. |

Target setup reuses the existing sheet, hook and callable. The browser
computes no target and sends only `{ mode, requestId }`.

The server treats a stale target as the current target. Freshness is
client-derived only. The product therefore takes the conservative path: it
asks the person to check a stale target before generating. The signed target
policy is not changed.

## Generation action safety

`NutritionV2PlanGeneration` sits over the existing `useNutritionV2RequestPlan`.

- **Explicit only.** Nothing runs on mount, render or refresh. There is no
  timer and no effect.
- **One click is one request.**
  - A ref blocks a second click in the same frame.
  - While the request is pending, the button is replaced by a status.
  - Nothing is retried with a new request id.
- **Minimal payload.** The browser sends `{ requestId }` only. The server
  decides everything else: initial or regeneration, base plan, start date,
  target version, slot order, input and quota.
- **Online only.** Nothing enters the Nutrition offline entry queue, and no
  browser-side plan data is created.
- **Timeout and convergence.**
  - The browser timeout stays `NUTRITION_REQUEST_PLAN_CLIENT_TIMEOUT_MS`
    (300 s).
  - There is no cancel.
  - If the browser loses the response, the server's request document is
    still the source of truth. A refresh shows the result.

Refusal and error copy is fixed German, chosen by stable code. The browser
never shows a raw Firebase error, stack trace or provider text.

| Code | Copy (abridged) |
| --- | --- |
| `UNAUTHENTICATED` | Bitte melde dich erneut an … |
| `INVALID_REQUEST` | … aktualisiere die Ansicht und versuche es erneut. |
| `NOT_ELIGIBLE` | … nur für Erwachsene mit Altersangabe … |
| `NUTRITION_AI_DISABLED` | Die Planerstellung ist vorübergehend nicht verfügbar … |
| `GENERATION_PROVIDER_NOT_CONFIGURED`, `PLAN_VALIDATION_POLICY_NOT_CONFIGURED` | Die Planerstellung ist gerade nicht verfügbar … |
| `NO_CURRENT_TARGET` | Lege zuerst dein Ernährungsziel fest … |
| `PLAN_NOT_ACTIVE` | Dein aktueller Plan hat sich inzwischen geändert … |
| `PLAN_NOT_REGENERABLE` | Dein nächster Plan hat noch nicht begonnen … |
| `GENERATION_SLOTS_NOT_CONFIGURED` | … Mahlzeiten pro Tag … Prüfe dein Ernährungsprofil. |
| `DIETARY_PREFERENCE_NOT_SUPPORTED` | Für die Ernährungsform Keto können derzeit keine Ernährungspläne erstellt werden. |
| `QUOTA_EXCEEDED` | Du hast die Anzahl neuer Ernährungspläne für diesen Monat erreicht … (no count, limit or ledger detail) |
| `INTERNAL` (and anything unknown) | … Bitte versuche es später noch einmal. |

The copy makes no medical, optimality, safety or allergy claim. A short note
under the action says the plan is a suggestion, not medical advice and not a
guarantee against allergens.

## Pre-flight (completed 2026-09-29, all application gates closed)

The operator completed the following:
- deployed the current Firestore rules to `fitssai-coach`, and verified the
  live rules hash matches `main`;
- deployed `nutritionSetTarget`, `nutritionUpdateSlot`, `nutritionRepeatPlan`
  and `nutritionRequestPlan`, and updated `coachBackendStatus`. All five are
  Gen 2, `nodejs22`, `europe-west3`. `nutritionRequestPlan` runs with a 240 s
  timeout, 256 MiB, `maxInstances` 5;
- enabled the Vertex AI API. The deployed runtime service account is
  `813249512866-compute@developer.gserviceaccount.com`, and its IAM
  technically permits Vertex prediction;
- accepted model `gemini-3.8-flash` in Vertex location `eu`, based on current
  official Google documentation;
- confirmed that no Nutrition V2 production documents existed at the
  inventory point.

At the pre-flight, the deployed backend still reported
`NUTRITION_AI_PRODUCTION_ENABLED = false`, `nutritionTargets = false` and
`nutritionGeneration = false`. It stayed that way until the PR was merged and
the Phase 2 deploy ran. Both are done; see the status above.

The runtime service account has the broad Editor role. Narrowing it to least
privilege is a later hardening item, not part of NUT-14 (see
[Open follow-ups](#open-follow-ups-non-blocking)).

## Operator privacy / data-processing decision

On **2026-09-29** the operator approved (“APPROVE FOR NUT-14”) NUT-14
production use of the minimized Nutrition generation payload with Google
Vertex AI (project `fitssai-coach`, location `eu`, model `gemini-3.8-flash`).
This is an operator/product sign-off, not a legal certification.

The provider payload is the strict `nutritionGenerationInputSchema`
(`functions/src/nutrition/generationInput.ts`), re-checked by the adapter
before the prompt is built:

| Sent | |
| --- | --- |
| `startDate` | the plan's first date |
| `dayCount` | 7 |
| `target` | kcal, protein, carbs and fat of the current TARGET |
| `slotOrder` | the meal slots, in canonical order |
| `dietaryPreference` | the stated preference, or null |

The payload does **not** include:
- uid, name or email;
- age or date of birth, height, weight or biological sex;
- activity level or fitness goal;
- the full profile, any Firestore path or any raw stored document.

No prompt, raw response or model reasoning is persisted. Nutrition writes no
AI log.

## Release order

Historical procedure. All three phases are complete (2026-09-29); see the
status at the top. The order still applies to a future rollback and
re-enablement.

Do not deploy anything from the implementation task.

**Phase 1 — merge.** Merging NUT-14 deploys the frontend to GitHub Pages
automatically. Firebase Functions are not deployed from CI. So the new
frontend first runs against the deployed backend, which still reports
`nutritionTargets=false` and `nutritionGeneration=false`. The new frontend
therefore shows **no target setup and no generation action**. Existing
read/record/replace behaviour keeps working. The tests pin this state:
`nutritionV2Enablement.test.tsx` "release order" and `nutrition-enablement.e2e.ts`.

**Phase 2 — targeted backend deploy.** Once the `main` Pages deployment is
green, deploy only these two functions:

```bash
firebase deploy --only functions:nutritionRequestPlan,functions:coachBackendStatus --project fitssai-coach
```

- `nutritionRequestPlan` needs the opened AI gate.
- `coachBackendStatus` needs the true capability flags.
- `nutritionSetTarget` was already deployed from the same baseline, and this
  PR does not change its server code, so it is not redeployed.

After this deploy, a session sees the new actions on its next load or
**Aktualisieren**.

**Phase 3 — production smoke test** with one approved adult test account
(below).

## Rollback

**Generation.** Do all three:
1. Set `NUTRITION_AI_PRODUCTION_ENABLED` back to `false`.
2. Set `nutritionGeneration` back to `false`.
3. Deploy `nutritionRequestPlan` and `coachBackendStatus`.

A closed gate refuses new work with `NUTRITION_AI_DISABLED` and writes
nothing. A finished request still replays, and a live one is still reported
as running.

**Target UI.** Set `nutritionTargets` back to `false` and deploy
`coachBackendStatus`. Target history is untouched. `nutritionSetTarget` itself
remains a deployed, authenticated, deterministic callable with **no separate
production kill gate**. `nutritionTargets=false` is the product exposure
rollback. A dedicated server target gate would be a separate, deliberately
designed change. NUT-14 does not add one.

**Frontend.** No frontend rollback is needed to hide the actions. A
capability of `false` hides them on the next status read (next load, or
**Aktualisieren**), because the status is never persisted.

Never delete any of the following:
- V2 plans, targets, entries or slot history;
- generation documents or the quota ledger;
- the offline queue.

Never silently return to legacy Nutrition.

## Production smoke plan

Defined by the NUT-14 PR, which did not run it. The operator ran it after
the Phase 2 deploy; the result follows this plan.

After the Phase 2 deploy, one approved adult production test account:

1. Loads Nutrition.
2. Verifies `coachBackendStatus` exposes `nutritionTargets=true` and
   `nutritionGeneration=true`.
3. Completes the profile, if necessary.
4. Creates one deterministic target through the product UI (**Ziel festlegen**).
5. Verifies exactly one current target.
6. Clicks **Ernährungsplan erstellen** once.
7. Waits for the real generation result.
8. Verifies exactly one generation request.
9. Verifies one active V2 plan.
10. Verifies Today and Week.
11. Reloads, and verifies there is no duplicate request.
12. Verifies one successful monthly `nutrition_plan_generation` quota unit.
13. Verifies that no prompt, raw response or model reasoning is persisted.
14. Verifies that TARGET, PLANNED and RECORDED are still separate: planned is
    never recorded, and recorded entries are unchanged snapshots.

Expected cost and quota: one successful `nutrition_plan_generation` unit.

## Production smoke result (PASSED, 2026-09-29)

The operator ran the plan above with one approved adult production account.
Every step passed. This record carries no uid, email, name, profile value,
screenshot, secret or token. `{uid}` stands for the smoke account.

**Capability and target**
- Nutrition V2 offered the target setup action.
- Exactly one calculated TARGET was created through the product UI and
  persisted across reload.

**Real AI generation**
- **Ernährungsplan erstellen** was clicked exactly once.
- The UI showed the running state ("Dein Ernährungsplan wird erstellt …").
- The real production generation succeeded, and the generated plan became
  the active plan.

**Product UI**
- The active plan rendered Today, the 7-day Week, the planned meals and the
  **Erfassen**, **Ersetzen**, **Eigene Mahlzeit** and **Neuen Plan erstellen**
  actions.
- The week covered 2026-09-29 through 2026-10-05.

**Reload and idempotency**
- A reload showed the same active plan.
- No second generation started after the reload.

**Generation document** (`users/{uid}/nutrition_v2_generations/{requestId}`)
- Exactly one document: the initial request the operator made.
- `schemaVersion` 2, `kind` `"initial"`, `basePlanId` null, `status`
  `"succeeded"`, `errorCode` null.
- `resultPlanId`, `targetVersionId`, `requestId`, `idempotencyKey`,
  `payloadFingerprint`, `createdAt` and `finishedAt` present.

**Plan document** (`users/{uid}/nutrition_v2_plans/{planId}`)
- Exactly one activated plan. Its id is the generation's `resultPlanId`.
- It holds the activated 7-day generated plan. Its meals match the rendered
  UI.

**Quota** (`_ai_quota/{uid}__nutrition_plan_generation__2026-09`)
- `action` `"nutrition_plan_generation"`, `period` `"2026-09"`, `count` 1,
  `reservations` `[]`.
- The smoke used exactly one successful Nutrition plan unit of the monthly
  allowance of 4.

**Privacy and persistence**

The generation document keeps lifecycle metadata and the payload fingerprint
only, as designed. It does not contain:
- the provider prompt, the raw provider response or model reasoning;
- the full profile;
- the user's name or email;
- height or weight.

**Semantics**
- Generated meals showed as planned ("geplant").
- Recording status showed separately ("Nicht erfasst").
- TARGET, PLANNED and RECORDED stayed separate.

## Open follow-ups (non-blocking)

None of these blocks NUT-14 or changes its production state. Each is a
separate, deliberately reviewed slice.

1. **Runtime service-account least privilege.** The production Nutrition
   runtime uses `813249512866-compute@developer.gserviceaccount.com` with the
   broad `roles/editor`. Narrow it to least privilege. NUT-14 changes no IAM.
2. **320 px "Ausgelassen" clipping.** The known NUT-13B layout diagnostic.
   Fixed by NUT-12D.2, which also makes the E2E check a required one
   (`docs/dev/nutrition-e2e.md`).
3. **`firebase-functions` outdated-package warning.** The Phase 2
   `firebase deploy` warned that `firebase-functions` (`^7.3.2` in
   `functions/package.json`) is outdated. Upgrading is a separate
   dependency slice with its own Functions and emulator validation. NUT-14
   upgrades nothing.

## Tests

| Area | Tests |
| --- | --- |
| Gate and flags | `providerBoundary.test.ts` (literal `true`, no env path, Training flags unchanged), `status.test.ts`, `generationBoundary.test.ts` (flag equals gate, generator configured), `targetBoundary.test.ts`, `planBoundary.test.ts`, `slotBoundary.test.ts`, `backend.test.ts` |
| Production path | `requestPlan.test.ts` runs the deployed gate with every production registry. It uses a scripted SDK client and never reaches Vertex. It also covers the closed-gate rollback and the Keto and quota refusals before the SDK is asked. |
| Capability query | `useCoachBackendCapabilities.test.tsx`, `queryPersistence.test.tsx` |
| Pure availability and copy | `planGeneration.test.ts` |
| Product integration | `src/test/nutritionV2Enablement.test.tsx`: release order, pending/false/true/error/mismatch, one read per session, refresh, target setup (calculated, manual, `TARGET_INFEASIBLE`, stale), generation (one click, double click, success, refusals, offline, active request, regeneration, keto), A → B isolation, restore of an old stored status |
| E2E | `e2e/tests/nutrition-enablement.e2e.ts`: live emulator status, real deterministic target setup, generation through a mocked callable only |

No unit, component or E2E test makes a Vertex AI call. The emulator has no
credentials, and every E2E generation request is answered at the browser
boundary or refused before provider work.
