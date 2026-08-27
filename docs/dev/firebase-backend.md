# Firebase backend

The server-side execution layer FitssAI's future coaching features will run on.

PR50 built the layer. It does **not** contain a model, a provider, an API key,
or any user-facing AI capability — those arrive in PR51. Everything below
describes what exists today.

## Architecture

```
functions/                 Firebase Functions workspace (own dependency tree)
  src/
    index.ts               Callable entry points — thin Firebase wrappers only
    auth.ts                requireAuth(): identity from the verified token
    config.ts              Region, backend name, capability flags
    coaching/
      status.ts            Pure handler behind coachBackendStatus
      provider.ts          CoachProvider seam — no implementation
      planGenerationInput.ts  Minimised input contract for a future provider
    quota/index.ts         Server-authoritative quota abstraction
    logging/aiLog.ts       ai_logs write contract — no writer

shared/                    Compiled by BOTH workspaces
  workoutPlan.ts           The one workout-plan schema (Zod)

src/lib/backend/           Client side of the callable boundary
```

Each callable is a thin wrapper around a pure handler. The wrapper owns runtime
concerns (region, instance caps, the callable protocol); the handler owns the
decisions, so the decisions are testable without a deployment or an emulator.

## Firebase project identity

**Not determinable from this repository, and deliberately not guessed.**

The client reads its whole config from `VITE_FIREBASE_*` variables, which are
supplied as GitHub Actions secrets at build time (`.github/workflows/deploy.yml`).
No project id is committed, and there is no `.firebaserc`.

Firebase web config values are public identifiers rather than secrets, but the
project id still has to come from the project owner. To finish the setup:

```bash
firebase login
firebase use --add          # select the FitssAI project, alias it "default"
```

That writes `.firebaserc`. Commit it — it contains only the project id.

## Region

`europe-west3` (Frankfurt), set in `functions/src/config.ts` and mirrored in
`src/lib/backend/region.ts`; a test pins the two together, because a mismatch
produces a 404 that reads like a missing function.

Frankfurt is the closest supported region to FitssAI's German user base and
keeps request handling inside the EU. It was chosen over the `us-central1`
default deliberately. If the project's Firestore location turns out to be
elsewhere and co-location matters more than proximity, change the constant in
`config.ts` — it is the only place the region is decided.

## Firestore rules

The deployed rules are now version-controlled in `firestore.rules`, captured
from production on 2026-08-27 and referenced by `firebase.json`.

### The access model

* `/users/{userId}` — the signed-in owner, and nobody else, may read and write.
* `/users/{userId}/{subcollection}/{docId}` and one further level of nesting —
  same owner-only rule. This is where `workout_plans`, `workout_logs`,
  `nutrition_plans`, `ai_logs` and `workout_set_logs` live.
* `/exercises/{exerciseId}` — readable by any signed-in user, writable by no
  client.
* Nothing else is reachable. A path the rules do not mention is denied.

There is no cross-user access anywhere, and no anonymous access anywhere.

### Protected authorization fields

On the profile document `/users/{userId}` the client may not introduce, change
or remove any of:

```
role   admin   isAdmin   roles   permissions
```

`role` is the one the app reads. The others are the spellings a future feature
might reach for; listing them costs nothing and means the rule does not have to
be revisited to stay correct.

This closes a real privilege-escalation path. The previous `allow write` let a
signed-in user set `role: "admin"` on their own profile straight from the
client SDK — the app never writes `role` from any code path, but the rules were
what actually decided, and they permitted it.

Semantics, all covered by tests:

| Operation | Rule |
|---|---|
| **create** | Owner only, and the new document may not carry a protected field. |
| **update** | Owner only, and no protected field may appear in `affectedKeys()` — which covers added, changed *and* removed alike, including a full-document overwrite that would drop a role. Writing an identical value back is not an affected key, so ordinary profile saves are unaffected. |
| **delete** | Owner only. Unchanged from production: no client path deletes a profile document today (there is no self-service account deletion), so removing it would be a behaviour change with no security benefit. |

The protection is scoped to the profile document. A `role` field on a workout
log means nothing and is allowed, so the rule cannot leak downward and start
refusing legitimate writes.

### The Admin SDK bypasses all of this

Cloud Functions using `firebase-admin` are **not** subject to Security Rules.
Future server-side quota counters and `ai_logs` writes therefore need no
allowance here, and these rules must never be loosened to accommodate a server:
if a write needs to happen that a client may not do, it belongs in a callable,
not in a widened rule.

### Current role-management limitation

There is no way to grant or revoke admin. The Admin Panel used to offer a
toggle that wrote another user's `role` from the browser; Firestore refused
that write, so the button could only ever fail, and it has been removed in
favour of copy that says so. A client that can grant itself admin is not a
security boundary — `role === "admin"` read in the browser is a UI convenience
and nothing more.

Granting a role today means editing the document in the Firebase Console.
Doing it properly means a callable that checks a custom claim; that is
deliberately out of scope until it is actually needed.

### Testing the rules

`rules-tests/` is an isolated workspace that runs the real rules engine in the
Firestore emulator — the only tests in this repository that can prove an
access-control claim, because everything else asserts what our own code does
rather than what Firestore will refuse.

```bash
npm --prefix rules-tests ci
npm run test:rules          # boots the emulator, runs the suite, shuts down
```

It needs Java (the emulator is a JAR) and a one-time emulator download; it
needs no credentials, and the `demo-fitssai` project id is Firebase's guarantee
that it can never reach a real project. CI runs it in a dedicated `rules` job
and the Pages deployment waits for it.

The suite was first run against the captured production rules, where the eight
role-escalation cases failed and the other twenty-two passed — the
vulnerability reproduced before it was fixed, and evidence that the capture
reproduces production faithfully.

### Deploying rules

```bash
firebase use                              # must show fitssai-coach
firebase deploy --only firestore:rules
```

Never a bare `firebase deploy`: it would push functions, and any hosting or
storage target that exists, in one go. Always name the target.

## Authenticated callable boundary

`coachBackendStatus` exists to prove one path works:

```
signed-in client → callable → verified auth context → response
```

* Identity comes from `request.auth.uid` and nothing else. A `uid`, `userId`,
  `admin` or `role` in the request payload is ignored — never merged, never a
  fallback.
* An unauthenticated call is refused with `HttpsError("unauthenticated")`.
* It reads no user document, writes nothing, calls no provider and consumes no
  quota.
* The response returns the caller's own uid and nothing else personal — no
  email, no name, no profile.

```jsonc
{
  "ok": true,
  "backend": "fitssai-coach",
  "region": "europe-west3",
  "uid": "<caller's own uid>",
  "capabilities": { "planGeneration": false, "weeklySummaryAI": false }
}
```

Both capability flags are `false` in code, not in a comment. They flip when the
capability behind them ships, not before.

## Shared workout-plan schema

`shared/workoutPlan.ts` is the single definition of the plan contract, imported
by the client as `@shared/workoutPlan` and by the functions build via a
relative path. It compiles into `functions/lib/shared/`, so the deployed bundle
is self-contained.

The contract: exactly four weeks (`Week 1`..`Week 4`, strict — a `Week 5` is
rejected, not dropped), exactly seven days per week (index 0 = Monday), a rest
day is a day with an empty `exercises` array, and an exercise needs a non-empty
`name`, a positive integer `sets` and a non-empty `reps` string. Unknown keys
pass through, because stored plans carry per-session fields such as `completed`.

`validateWorkoutPlanContent()` returns issues rather than throwing. **Generated
plan output must pass this schema before anything is persisted.**

## Provider interface

`CoachProvider` (`functions/src/coaching/provider.ts`) is provider-neutral and
returns `Promise<unknown>`. That is the important part: a provider is an
untrusted source, so the caller validates its output against the shared schema.
Letting the provider return a typed plan would make the provider the validation
boundary, and a confidently-typed lie would pass straight through.

`getCoachProvider()` returns `null`. There is no implementation and no provider
package in either dependency tree; tests enforce both.

## Data minimisation

`planGenerationInputSchema` is strict and accepts exactly: `goal`,
`experienceLevel`, `equipment`, `daysPerWeek`, `sessionMinutes`.

Never sent to a provider: name, email, uid, height, weight, date of birth,
dietary preferences, raw workout logs. `FORBIDDEN_PROVIDER_FIELDS` lists them
and a test rejects any input carrying one, so widening the input "just for
context" fails CI.

## Quota

`createQuotaService()` decides whether a chargeable action may run. Its only
inputs are the uid the auth guard resolved and the action name — there is no
argument through which a browser could assert its own balance.

No Firestore write happens yet. Persisting counters before a chargeable action
exists would create a production collection containing only zeroes. PR51 supplies
a real `QuotaStore`; until then `createNullQuotaStore()` reports zero usage and
*throws* on increment, so a chargeable path that forgets to configure a store
fails loudly instead of granting unlimited calls.

## AI logging

`users/{uid}/ai_logs` is already read by `useAISessions` and `useAIAnalytics`
and has never had a writer. `functions/src/logging/aiLog.ts` defines the
contract one will have to satisfy: action, status, provider/model id, latency,
token counts when the provider reports them, timestamp, error category.

**Prompts and responses are not stored by default**, and names and email
addresses are never stored — the document already lives under the user's own
uid. `FORBIDDEN_LOG_FIELDS` is enforced by a test.

No writer ships in this PR: with no AI request to record, a writer could only
produce fictional documents in a real user's history.

## Secrets

| Where | What may live there |
|---|---|
| `VITE_*` (GitHub Actions secrets → client bundle) | Firebase web config only. These are public identifiers. |
| Firebase Functions secrets (`firebase functions:secrets:set`) | Provider API keys, from PR51 onward. |
| The repository | Nothing. Ever. |

Anything prefixed `VITE_` is compiled into the browser bundle and readable by
every visitor, so a provider key must never be one. `VITE_OPENAI_API_KEY` and
its relatives are forbidden and tested for.

PR50 requires no provider secret. When PR51 needs one:

```bash
firebase functions:secrets:set PROVIDER_API_KEY
```

and declare it on the function with `secrets: ["PROVIDER_API_KEY"]`. It is
injected at runtime and never enters the repository or a build artifact.

`.gitignore` blocks `service_account.json`, `serviceAccountKey.json`,
`*-firebase-adminsdk-*.json`, `.env*` and `.runtimeconfig.json`.

## Local commands

```bash
npm --prefix functions ci          # install the backend workspace
npm run typecheck                  # client + functions (canonical)
npm run typecheck:client
npm run typecheck:functions
npm test                           # client suite
npm run test:functions             # backend suite
npm run test:all                   # both
npm run build                      # client
npm run build:functions            # backend → functions/lib/
npm run verify                     # everything above, in order
```

The backend suite is pure vitest in a node environment. No Java, no emulator
and no CLI is required to run it, so a contributor without the Firebase
toolchain can still validate the whole repository.

## Deployment

**GitHub Pages** deploys automatically from `main`. CI runs a backend job
(typecheck, tests, build) and a rules job (Firestore Security Rules against the
emulator); the Pages deployment waits for both.

**Firebase Functions are not deployed from CI.** Doing so would require a
long-lived credential in the repository, which is not an acceptable trade for
saving a manual step. A test asserts the workflow contains no `firebase deploy`
and no credential reference.

Manual deployment, always naming a target:

```bash
firebase use                            # must show fitssai-coach

# Functions:
npm --prefix functions ci
npm --prefix functions run typecheck
npm --prefix functions run test
firebase deploy --only functions

# Firestore rules:
firebase deploy --only firestore:rules
```

**Never a bare `firebase deploy`.** It pushes every configured target at once —
functions and rules together, plus any hosting or storage target that is added
later. Name the target every time.

Requirements: Blaze plan (active), an authenticated CLI, and the correct
project selected.

## Intentionally not implemented

* No AI provider, SDK, model call or API key.
* No automatic plan generation and no automatic plan mutation.
* No custom claims, no role hierarchy, and no way to grant admin — see
  *Current role-management limitation*.
* No App Check, no Storage rules, no per-collection field validation beyond the
  authorization fields named above.
* No `ai_logs` writer and no quota persistence.
* No user-facing AI affordance — "Neue Pläne erstellen" and "KI-Vorschlag"
  remain in their truthful unavailable states.
* No Firestore migration or backfill of any kind.
* No Firebase Functions deployment from CI.
