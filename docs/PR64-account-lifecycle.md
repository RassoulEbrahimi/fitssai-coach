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

## Live writes, not only replay (review follow-up)

Replay was guarded; live writes were not. Four production paths verified identity
only on the way in, so an operation begun by A could await a read, have
authentication switch to B underneath it, and carry on to its write. No A-to-B
write or rules bypass was demonstrated, but the invariant was not held.

`beginAccountOperation(uid)` now fixes the expected owner at the start of an
operation and returns a checkpoint closed over it. The checkpoint compares only
against the captured UID and cannot be re-pointed at whoever is signed in now:
the operation finishes as the account that began it or it does not finish.

| Path | Checkpoints added |
| --- | --- |
| `useSetTracking` toggle | After the parent-log lookup, before the set lookup, and after it — so neither `addDoc` nor `deleteDoc` runs for a changed account |
| `useWeekCompletion` toggle | After the exercise lookup, before `updateDoc`/`addDoc` |
| `useWorkoutLogs.toggleDay` | Captured at the action boundary; the writer re-checks |
| `recordSessionDuration` / `recordSuccessfulWorkoutFinish` | After the metadata outcomes, before the future-day guard, duration and write |
| `writeDaySessionRecord` | Before the query, before the transaction, and inside the transaction callback after `transaction.get` |

`writeDaySessionRecord`'s optional `assertCanWrite` default no-op is gone. A
guard a caller can decline is not a safe default, and every caller would have
passed the same closure anyway. The check is now intrinsic: `uid` is both the
subtree the write is addressed to and the account it must still belong to, so
there is no way to call this writer without it.

A finish that hits an account change throws rather than returning an outcome.
Both `SessionRecordOutcome` values are terminal to `TodayWorkoutCard` — it ends
the session and drops the frozen `endedAt` on either. Throwing keeps the
session, timer and stamped finish instant recoverable, reports no success and
completes nothing. Unusable metadata still reports `incomplete-metadata`,
because the owner check sits after those outcomes.

`retryWithBackoff` no longer retries `AccountChangedError`. Identity will not
revert, and the default 3-retry backoff held a finish open for seven seconds
before reporting a failure it already knew about.

## Authentication that fails to initialize (review follow-up)

Verified against the installed SDK — firebase 10.14.1, @firebase/auth 1.7.9 — by
`src/test/firebaseAuthLifecycle.probe.test.ts`, which drives the real library
rather than a mock:

- `AuthImpl.registerStateListener` attaches the observer as
  `promise.then(() => cb(this.currentUser))` on `_initializationPromise`, with no
  rejection handler. `_initializeWithPersistence` awaits
  `PersistenceUserManager.create` and `initializeCurrentUser` catching neither.
  A rejection therefore reaches neither the `next` callback nor the `error` one,
  and `authStateReady()` hangs on the same call. Each subscriber is also left
  holding a derived promise nothing will settle; the probe asserts those leaks.
- `_isInitialized = true` is assigned in exactly one place, at the tail of the
  queued task that just threw, so it stays false for the life of the instance.
- `notifyAuthListeners()` opens with `if (!this._isInitialized) { return; }`.

That last line is the reason exposing the sign-in routes was not a fix. Signing
in against a failed instance succeeds at the server and sets `auth.currentUser`,
and every publication of it is dropped — for observers registered before the
failure and after it alike. The app would stay `user = null`, report a
successful sign-in, and bounce off the dashboard. The probe reproduces exactly
that. No public API sets `_isInitialized`, and `getAuth(app)` returns the same
object, so the instance cannot be repaired in place.

Recovery is therefore: clear Firebase Auth's persisted state, reload, and let a
fresh instance initialize. A reload alone would rejoin the same corrupt store.

`src/lib/authPersistenceRecovery.ts` holds the only Firebase-internal knowledge
in the codebase, so an SDK upgrade has one place to check and the probe's version
assertions fail loudly if it moves.

**Cleanup is scoped to this Firebase app, not to the origin.** `_persistenceKeyName`
builds `firebase:<name>:<apiKey>:<appName>` by literal interpolation, and every
call site in the pinned SDK passes one of four names: `authUser`, `persistence`,
`redirectUser`, `pendingRedirect`. Those four are combined with `auth.config.apiKey`
and `auth.name` — both public Auth fields, so the scope comes from the app
configuration rather than a second copy of the credentials — into an exact
allowlist. Keys are compared by equality; there is no prefix match and no regex
sweep. If either half of the scope is missing, nothing is targeted at all.

**IndexedDB is cleaned record by record.** `firebaseLocalStorageDb` is one
database per *origin*, and every Firebase app on that origin keeps its rows in
the same `firebaseLocalStorage` store under the same `fbase_key` strings. So the
earlier `deleteDatabase` call would have signed the user out of unrelated
applications that merely share the host. The store is now opened without a
version, and each allowlisted key is removed with an individual
`objectStore.delete`; every other row is left in place. Absent database, absent
store, open error, blocked open, aborted transaction and an open that never
settles are each handled and reported, bounded by a two-second timeout. An empty
database created by the open itself is removed again rather than left behind,
since a storeless database of that name is one of the states the SDK has to
recover from.

**Automatic recovery requires a loop guard that provably persisted.** The marker
is written and then read back — a `setItem` can fail without throwing, and an
automatic reload on the strength of a guard that is not really there is an
automatic reload that repeats on every load. If the marker cannot be written or
even read, no cleanup and no reload happen at all; the recovery screen simply
offers the repair. Manual retry is different: a person pressing the button is
their own bound on repetition, so it proceeds whether or not the guard sticks.

**Reaching a storage area is itself inside the boundary.** `window.localStorage`
is a getter that throws SecurityError outright when the browser blocks site data,
before any method is called on it, so the lookup is guarded too. Unavailable
storage, a failed write, and an IndexedDB open or transaction failure are
reported apart rather than collapsed, because the caller decides whether a reload
could help. Recovery always resolves to an explicit outcome rather than
rejecting, and the provider catches the promise either way.

**No path can strand the UI.** `repairing` is true only while a reload is
genuinely on its way. A guard that could not be stored, storage that cannot be
reached, IndexedDB that would not open, a repair already spent, or an error
nobody anticipated all put the retry button back and keep the recovery mode —
never a spinner over an app with no way out, and never a sign-in offered against
an instance that cannot publish the result.

The marker also had to be exempted from `clearSignOutSensitiveStorage`'s
`fitssai.` sessionStorage sweep, which runs on every resolved auth transition
including the failure one. Without that exemption each failure erased the
evidence of the last and the page reloaded forever; the test that reloads a
still-broken store twice is what caught it.

While authentication is unavailable, `AuthRecoveryScreen` stands in place of the
children — not merely alongside them. No account-scoped provider mounts, and no
sign-in form is offered against an instance that cannot publish the result.


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
