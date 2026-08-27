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

## The model

**`gemini-3.7-flash`**, via **`@google/genai`** (the current official Node SDK;
`@google/generative-ai` is superseded and receives no new features).

The id lives in exactly one place — `GEMINI_MODEL_ID` in
`functions/src/coaching/providers/gemini.ts` — with the verification date
beside it, and a test asserts it. Google retires Flash generations on roughly
annual cycles: the model originally specified for this work, `gemini-2.5-flash`,
already carried an announced shutdown by the time it was checked. A migration
should be one line plus a failing test, not an archaeology exercise.

Paid promotional pricing at time of writing: **$0.75 per million input tokens
and $3.75 per million output tokens through 2026-12-31**, rising afterwards.
That is what the quota below is sized against; revisit it in December.

Cost controls, all in `GENERATION_CONFIG`: temperature 0.4 (this is structured
generation — variety in JSON shape is only a way to fail validation), one
candidate (alternatives would be billed and discarded), and an 8192-token
output cap, which is generous for four weeks of exercises and no more.
Transport retries are bounded at two and apply only to 429/5xx.

Provider SDK imports are confined to `coaching/providers/`; a test fails if one
appears anywhere else, because the seam is only worth having if the vendor
stays behind it.

## Plan generation

`generateWorkoutPlan` is a callable in `europe-west3`. The order of operations
is the design:

```
auth (verified token)
  → request id claimed (duplicate protection)
    → profile read server-side (five fields, nothing else)
      → quota reserved  ← the last thing that can refuse for free
        → provider call
          → Zod validation → semantic validation
            → at most ONE repair attempt
              → Admin SDK persists a NEW plan
                → quota stays charged, ai_log written
```

Everything that can refuse the request for free runs before the one step that
costs money.

**The client sends one opaque request id and nothing else.** Goal, experience,
equipment, days per week and session minutes are read from the caller's own
profile by the Function — a client-supplied profile is a client-supplied
prompt, and reading it under the verified uid means a caller cannot generate
from somebody else's answers. A `uid` in the payload is ignored.

**Nothing is guessed.** A missing preference produces `PROFILE_INCOMPLETE`
naming the fields, because inventing "full gym, three days, sixty minutes"
would produce a confident plan for a person who never said any of that.

**The plan is written by the server.** The client receives a plan id, never a
plan document: a browser that could hand back "the generated plan" could hand
back anything. Existing plans are never touched — the app already selects the
newest by `createdAt`, so a new plan becomes the active one without deleting
or archiving anything.

### Validation

Two layers, both after the provider:

1. **`validateWorkoutPlanContent`** — the shared Zod schema. Structured output
   makes valid output likely; it does not guarantee it, and a model that
   returns four weeks of nothing satisfies the response schema perfectly.
2. **`validatePlanSemantics`** — what the schema cannot see: the right number
   of training days for this user, no duplicate day labels, no exercise
   requiring equipment they do not have, and a broad upper bound on exercises
   per session. Deliberately conservative; it does not claim to compute session
   duration, because duration per exercise is genuinely unknown.

Failures from both feed **one** repair attempt with concise machine-readable
issues — never a loop, and never the whole previous conversation. If the second
attempt also fails, nothing is persisted and nothing is charged.

### Structured output

`planResponseSchema` is a small explicit adapter, not a serialised Zod schema:
Gemini accepts a restricted OpenAPI subset with no equivalent for
`passthrough`, unions or refinements. It is built *from* the shared constants,
so the week keys and day count cannot drift, and a parity test pins the rest —
including that a document built to the provider schema passes the Zod one.

## Quota

**Three successful generations per user per calendar month.**

A calendar bucket was chosen over a rolling 30-day window: a rolling window
needs a list of timestamps per user, pruning, and a read that grows with usage;
a calendar bucket is one document with one integer. The cost is a boundary
effect — three on the 31st and three on the 1st — acceptable for a cost control
and not for a security control.

Stored in **`_ai_quota/{uid}__{action}__{period}`**, denied to every client.

Charging is a **reservation**: incremented transactionally *before* the
provider call, so two simultaneous requests cannot both take the last one, and
released on every failure below it, so only a persisted plan stays charged. The
honest trade-off: if the process dies mid-flight the reservation is not
released and the user loses one generation that month. It fails toward
protecting the bill rather than toward giving away calls.

Not charged: auth failure, malformed request, incomplete profile, provider
failure, invalid output after the repair, persistence failure, or a replay.

## Idempotency

`_ai_operations/{uid}__{requestId}`, also client-denied. The client generates a
v4 UUID per attempt; the server validates the format, claims it in a
transaction, and a replay of a completed id returns the original plan id
without calling the provider or charging again. The id is namespaced by uid, so
one user replaying another's gets nothing, and it never becomes the plan id — a
client-chosen document id is a client-chosen write target.

A *failed* attempt may be retried with the same id: nothing was persisted or
charged, so there is nothing to reuse.

## AI logging

Authoritative logs go to **`_ai_logs`** — top-level, client-denied.

They deliberately do **not** go to `users/{uid}/ai_logs`, which the owner can
edit: a record of what was spent is worthless if the person it bills can
rewrite it. That older collection is left alone; nothing writes it, and no
historical data was migrated.

Fields: `uid`, `action`, `status`, `provider`, `model`, `latencyMs`,
`createdAt`, `providerCalled`, `schemaRepairUsed`, `planId` on success,
`errorCategory` on failure, and token counts **only when the provider reported
them** — absent stays absent, because "not reported" and "zero tokens" are
different facts. Cost is not computed here; a future analytics layer can apply
pricing to the counts.

**Never stored:** prompt text, model response, name, email, raw profile, or the
API key. `FORBIDDEN_LOG_FIELDS` is enforced by the writer at write time, which
refuses the document rather than the request — losing an operational log beats
storing what the user was asked.

A refusal that never reached the provider is logged with `providerCalled:
false`, so operational volume is not mistaken for spend.

## Provider secret

`GEMINI_API_KEY`, a Firebase Functions secret declared on the callable and read
only at call time.

```bash
firebase functions:secrets:set GEMINI_API_KEY   # paste the key when prompted
```

Create or verify the key in **Google AI Studio** (`aistudio.google.com` →
*Get API key*), attached to the billing-enabled Google Cloud project you intend
to pay from — a key on a different project bills a different account, or hits
free-tier limits. Verify it without exposing it by making one small request
from a shell where the key is in an environment variable, never by pasting it
into a file, a chat, a screenshot or a commit.

To rotate: create the new key, run `functions:secrets:set` again (which adds a
new version), redeploy with `firebase deploy --only functions`, then revoke the
old key in AI Studio. `firebase functions:secrets:destroy GEMINI_API_KEY@N`
removes an old version once nothing references it.

**Never** `VITE_GEMINI_API_KEY` or any `VITE_` prefix: those are compiled into
the browser bundle and readable by every visitor. Tests fail if one appears.

## Current AI capabilities

| Capability | State |
|---|---|
| Four-week workout-plan generation | **Live** (PR55) |
| Weekly AI summaries | Not implemented — `weeklySummaryAI` is `false` |
| Nutrition generation | Not implemented |
| Exercise suggestions in Add Workout | Not implemented — that tab offers exercises for one day, which a four-week generator is not |
| AI usage statistics in Profile | Not available — the authoritative log is server-only by design |



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

# The provider secret (interactive; paste the key at the prompt):
firebase functions:secrets:set GEMINI_API_KEY
```

**Never a bare `firebase deploy`.** It pushes every configured target at once —
functions and rules together, plus any hosting or storage target that is added
later. Name the target every time.

Requirements: Blaze plan (active), an authenticated CLI, and the correct
project selected.

## Intentionally not implemented

* No automatic plan mutation: generation adds a plan, and never edits or
  deletes an existing one.
* No custom claims, no role hierarchy, and no way to grant admin — see
  *Current role-management limitation*.
* No App Check, no Storage rules, no per-collection field validation beyond the
  authorization fields named above.
* No weekly AI summaries, no nutrition generation, and no exercise-level
  suggestions — see the capability table above.
* No Firestore migration or backfill of any kind.
* No Firebase Functions deployment from CI.
