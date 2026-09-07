# PR #64: account-bound offline state and sign-out cleanup

## Baseline and root cause

Verified repository `D:\Git\fitssai-coach`, clean `main` at
`ace9bee1c8f3ca4bc05dc09223197bca252a32ec`. Local `origin/main` and GitHub's
`refs/heads/main` matched. Work is on `codex/pr-64-account-lifecycle-isolation`.

The queue had no owner metadata. Each handler chose its Firestore path from
`auth.currentUser.uid` during replay, allowing A's payload to become B's write.
Query persistence used a global key and a module-level QueryClient. Training
providers mounted outside AuthProvider and restored globally stored sessions
before identity was known. Sign-out cleanup was present in only one UI path.

## Exact persisted-state inventory

All localStorage rows survive reload and normal browser restart until explicitly
removed. Before this change, they also survived account switch/sign-out unless
the LogoutButton's limited cleanup ran. SessionStorage survives reload in a tab;
browser session restoration may retain it, so tab closure is not an isolation rule.

| State / storage | Before | After / lifecycle policy |
| --- | --- | --- |
| `FITSSAI_OFFLINE_QUEUE` / localStorage | Global operations without owners; not cleared by either sign-out path | Same key; every new entry records authenticated `ownerUid`. Retain pending work for its original account. Hide other owners from queue UI and skip their replay. |
| Ownerless queue entries | Replayed as whichever user was current | Preserve ID/payload/time/attempts in place with `status: quarantined` and diagnostic `lastError`; never infer an owner. A warning contains no payload. |
| `REACT_QUERY_OFFLINE_CACHE` / localStorage | Global persisted queries and paused mutations, hydrated by a singleton client | Legacy key purged on resolved auth events and explicit sign-out. New key is `REACT_QUERY_OFFLINE_CACHE:<encoded UID>` with buster `account-owned-v1`; fresh QueryClient and mounted subtree per UID. Retain each owner's namespace. No mutation execution/retry redesign. |
| `fitssai.training.session` / localStorage | Plan/day/start and optional frozen finish time, no account binding | Production reads/writes only `fitssai.training.session:<encoded UID>`. Legacy ownerless key purged; no guessed migration. Same owner's plan/day/start/finish stamps survive reload and sign-in again. |
| `fitssai.training.session.started`, `fitssai.training.session.start_time` / localStorage | Legacy unbound timer keys; already rejected by session migration | Continue clearing; never used to resume a session. |
| `fitssai.training.cache` / localStorage | Global exercise/workout context | Production uses `fitssai.training.cache:<encoded UID>`; storage events match only that exact key. Retain for its owner; purge global legacy key. |
| `fitssai.nudges.v1` / localStorage | Device-local delivery/dismissal history containing plan-day identifiers | Use `fitssai.nudges.v1:<encoded UID>`; retain each owner's history, purge ownerless history. Notification permission remains a browser preference. |
| `fitssai.theme`, legacy `theme` / localStorage | Device theme; legacy key migrates on theme resolution | Preserve; existing theme migration unchanged. |
| `fitssai.preferences.enableAdvancedGlass` / localStorage | Device display preference | Preserve. |
| `fitssai:compactCards`, `fitssai:lastSmartFocus` / localStorage | Compatibility preferences in cleanup allowlist; no current writers found | Preserve. |
| `fitssai.*` / sessionStorage | Legacy derived per-tab caches, e.g. AI nudges; no current production writers found | Sweep on resolved auth events and explicit sign-out; unrelated keys survive. |
| `fitssai.workout_started_<date>`, `fitssai.workout_timer_start_<date>` | Unused helper declarations in TodayWorkoutCard; no current reads/writes | Inert; not a source of active/resumed state. |
| Firebase Auth persistence / SDK-managed IndexedDB/storage | SDK authentication identity survives restart | SDK continues managing it. Application waits for `onAuthStateChanged` before mounting consumers. |
| Firestore client cache | `getFirestore` uses memory cache; no persistent Firestore cache configured | Unchanged. All replay paths use `users/<stored owner>/...`, with identity checks before writes. |
| Workbox / CacheStorage | PWA asset precache, no account data runtime cache | Unchanged. |

Training, profile hydration, query observers, review, insights, nudge hooks and
other account consumers are remounted on a UID change. Same-UID auth events and
ordinary rerenders preserve the mounted instances. Theme, notification permission,
and other device settings remain. Account namespaces retained on disk are isolated
application state, not encrypted storage or protection against malicious same-origin code.

## Sign-out paths

| Production path | Before | After |
| --- | --- | --- |
| Navbar desktop/mobile → `useAuth().signOut()` | Firebase sign-out only | `signOutAccount()` → Firebase sign-out + centralized legacy-storage cleanup |
| Profile/settings `LogoutButton` | Direct Firebase sign-out + partial local cleanup | Same `signOutAccount()` helper |
| External / another-tab Firebase sign-out or direct account switch | Only changed React user | Auth observer cleans legacy storage before publishing identity; keyed account subtree replaces all mounted account state |

Only `src/lib/signOut.ts` imports Firebase `signOut`. Account deletion is a hidden
support-only UI, not a production authentication/sign-out path. No auth framework,
route definitions, sign-in flow, or account deletion behavior changes.

## Ownership and replay contract

`entry.ownerUid === currentAuthenticatedUid` is required for replay.

Enqueue captures Firebase identity synchronously and checks it against the mounted
producer's UID. Anonymous/stale producers fail instead of assigning work to a new
account. `ownerUid` is readonly; status patches cannot overwrite it, including at
runtime. Handlers receive owner separately from payload and derive every Firestore
path from that stored owner. Payload `uid`/`ownerUid` fields are ignored and never
copied into writes. No additional PII is introduced beyond the UID.

The replay loop checks identity before starting each entry. All three handlers
check at entry and after awaited reads before writing. The shared day writer takes
an optional guard that replay supplies; it checks again inside every transaction
callback before set/update. If identity changes mid-operation, replay leaves the
entry pending under its original owner and stops. An already dispatched write
cannot be recalled; its path remains the original owner's and server authorization
still applies. It is never redirected to the new account.

The action wrapper also checks its captured owner before execution/retries and
network-failure enqueue. Query persistence is scoped even where query keys are not.
Old in-flight results and throttled persistence callbacks can address only the
retired owner's client/key, not the next account's client/key.

## Tests and security evidence

`src/test/accountLifecycle.test.tsx` mounts the real AuthProvider, QueryProvider,
TrainingProvider, offline hook, action wrapper, queue storage and handlers. Firebase
auth events and Firestore I/O are controlled test boundaries. It covers:

- A queues → signs out → B cannot replay → A returns and replays as A.
- Multiple entries survive simulated reload/browser recreation without acquiring B ownership.
- Legacy ownerless entries remain quarantined and preserve their original payload.
- Both application sign-out entry points and external auth events apply cleanup.
- A's query data never appears in any observed B render, even with identical query keys;
  late results on the retired client remain isolated.
- B cannot resume A's active session or workout context, even with matching plan IDs.
- Same UID rerender/auth event/reload preserves active session and frozen finish time.
- Device preferences and unrelated storage survive.
- Anonymous/stale enqueue and owner patching are rejected; every handler rejects
  owner mismatch/missing owner before Firestore reads or writes.
- Mutable payload UID fields cannot redirect writes.
- Account changes during the day transaction and delayed network failures stop new writes/enqueue.

`offlineHandlers.test.ts` additionally switches accounts during exercise/set reads,
including the second set lookup. Existing TrainingContext and TodayWorkoutCard
fixtures now seed the explicit test-owner namespace, preserving the PR #62/#63
finish recovery, explicit completion, calendar/activity/review/nudge regression tests.

No Firestore rules, backend functions, server ownership schema, or workout-plan
mutation code changes. Tests exercise client enforcement without bypassing rules;
they are not an emulator proof of server authorization.

## Deliberately deferred to PR #65

No redesign of TanStack offline mutation execution, syncing leases, interrupted
replay recovery, localStorage write durability, or exactly-once semantics. Queue
read/modify/write remains non-transactional across tabs and storage writes remain
best-effort. This PR establishes ownership, not durable delivery. Legacy ownerless
sessions/caches cannot be attributed safely and are not migrated to whoever signs
in next. No new blocker to PR #65 is identified; it must preserve these owner checks.

## Validation

Validation results are recorded in the PR description and final handoff. Backend
and rules tests are intentionally omitted because those areas are unchanged.
