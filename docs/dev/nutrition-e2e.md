# NUT-13A — Local authenticated Nutrition V2 E2E harness

A local, fail-closed browser E2E environment: the real app, signed in to the
**Firebase Auth emulator**, reading and writing the **Firestore emulator** and
calling the **Functions emulator** — with deterministic Nutrition V2 test
accounts. It exists so the remaining NUT-13 flows can be exercised on
populated V2 data without touching production.

**No production data is used.** Every account, profile, target, plan and
recording lives in the emulators of the demo project `demo-fitssai`, is wiped
on every seed, and never leaves this machine. Production Firebase receives no
read or write from this harness; production AI is never called.

NUT-13 is **not** passed by this slice. NUT-13A builds and smoke-tests the
harness; NUT-13B uses it for the product validation (see the end).

## Safety model

Emulator mode requires, at the same time:

1. **An explicit flag.** The browser routes to the emulators only when the
   build environment says exactly `VITE_FIREBASE_USE_EMULATORS=true`. Nothing
   is inferred from the hostname, the Vite mode or a dev build.
2. **The demo project.** The project id must be `demo-fitssai`. The production
   id `fitssai-coach` — or any other — is refused, and so is a `demo-` id
   *without* the flag. Firebase never maps a `demo-` project to real resources.
3. **An explicit, local emulator host.** Loopback or a private LAN IPv4
   address (10/8, 172.16/12, 192.168/16) only; a public host is refused.
4. **No real browser key.** A placeholder API key is required; a real one
   (`AIza…`) is refused.

Where it is enforced:

| Layer | Guard |
| --- | --- |
| Browser | `src/lib/firebaseEmulators.ts` `resolveFirebaseEmulatorConfig` runs first in `src/lib/firebase.ts` and throws before any Firebase service exists. `connectFirebaseEmulators` is the only place an emulator is connected. It routes Auth, Firestore and the cached `getFunctions(app, "europe-west3")` instance, which every callable obtains (a boundary test pins this). |
| Production build | `vite.config.ts` refuses `vite build` whenever `VITE_FIREBASE_USE_EMULATORS` is set to anything but empty/`false`. Emulator mode exists only on the dev server. |
| Node (seed, setup, launchers) | `e2e/support/emulatorEnv.ts` `requireLocalEmulatorEnv` requires `GCLOUD_PROJECT=demo-fitssai` and loopback/LAN `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST` and `FIREBASE_FUNCTIONS_EMULATOR_HOST`. It defaults nothing. The REST helpers refuse any URL that is not one of those emulators. |
| Emulator process | `e2e/support/processEnv.ts` `emulatorProcessEnv` starts the Firebase CLI with no Google credentials. There are no `GOOGLE_APPLICATION_CREDENTIALS`, and APPDATA, `XDG_CONFIG_HOME` and `CLOUDSDK_CONFIG` point at empty directories, so neither gcloud ADC nor the `firebase login` account can be handed to the Functions runtime. |
| AI | Unchanged: `NUTRITION_AI_PRODUCTION_ENABLED = false`, `nutritionTargets = false`, `nutritionGeneration = false`. The Functions emulator runs the same build, so `nutritionRequestPlan` answers `NUTRITION_AI_DISABLED`. The smoke suite asserts this. |

The seed is outside `functions/`, so Functions deployment cannot package it,
and `e2e/` is not part of any build.

## Prerequisites

- Node 22+ (the repo runs on the host Node), `npm ci --legacy-peer-deps` and
  `npm --prefix functions ci`.
- Firebase CLI: `npm install -g firebase-tools` (as for `npm run test:rules`).
- Java 11+ for the Firestore emulator (`JAVA_HOME`/`PATH`).
- Google Chrome (Playwright uses the installed Chrome; no browser download).
  Alternatively `npx playwright install chromium` and `E2E_BROWSER_CHANNEL=chromium`.
- Optional: copy `.env.e2e.example` to `.env.e2e.local` (gitignored).

Ports (`firebase.json`): Auth **9099**, Firestore **8080**, Functions
**5001**, E2E client **5180** (Vite's usual 8080 is taken by Firestore). The
Emulator UI stays disabled and is not needed. `npm run test:rules` still
starts only the Firestore emulator and is unaffected.

## Commands

| Command | What it does |
| --- | --- |
| `npm run e2e:nutrition` | Builds Functions, starts the three emulators (`emulators:exec`), resets and seeds them, starts the E2E client, runs Playwright headless, stops everything. |
| `npm run e2e:nutrition:headed` | The same, with a visible browser. |
| `npm run e2e:nutrition:attach` | Runs Playwright against emulators you already started. |
| `npm run e2e:emulators` | Builds Functions, then starts the three emulators and keeps them running (loopback). |
| `npm run e2e:emulators:lan` | The same, listening on all interfaces, for a phone. |
| `npm run e2e:seed` | Resets the running emulators and seeds the accounts. Needs `E2E_NUTRITION_PASSWORD`. |
| `npm run e2e:client` | Serves the real app at `http://127.0.0.1:5180/fitssai-coach/` in emulator mode. |
| `npm run e2e:client:lan` | The same on `0.0.0.0`, routing to the LAN emulator host. |

Any extra argument to `e2e:nutrition` goes to `playwright test`, e.g.
`npm run e2e:nutrition -- -g "isolation"` (in PowerShell, which drops a bare
`--`, run `npx tsx e2e/scripts/run.ts -g isolation`). Reports, traces and screenshots
land in `e2e/results.local/` (gitignored).

## Seeded accounts

`npm run e2e:seed` (and Playwright's global setup) first **wipes** every
emulator account and document of `demo-fitssai`, then creates:

| Key | Email | Profile | Nutrition V2 |
| --- | --- | --- | --- |
| A `adult` | `nutrition-adult@fitssai-e2e.test` | complete, 34, male, maintain, moderately active | target + active plan |
| B `isolation` | `nutrition-isolation@fitssai-e2e.test` | complete, 29, female, loseFat, lightly active, vegetarian | its own target + plan, no meal name in common with A |
| C `missingAge` | `nutrition-missing-age@fitssai-e2e.test` | every answer but the age | none |
| D `minor` | `nutrition-minor@fitssai-e2e.test` | 16 | none |

All four share the password `E2E_NUTRITION_PASSWORD`. For `npm run e2e:seed`,
set it in `.env.e2e.local` to a throwaway value you use nowhere else. It is
never printed or written anywhere. `npm run e2e:nutrition` generates a random
one per run when it is unset. The `.test` domain is reserved and no address
is real.

How the V2 data is produced, through the application's own server paths:

1. The profile document `users/{uid}` is written as onboarding and the
   Nutrition profile section write it.
2. The **TARGET** comes from the real `nutritionSetTarget` callable on the
   Functions emulator, called with the account's own emulator ID token. It is
   the signed `calculated-target` v1 policy (A: 2728 kcal).
3. The **plan** is 7 contiguous dates from *Berlin today − 3* to *today + 3*.
   It has slot order breakfast, lunch, dinner and a distinct meal per slot and
   day. Macros scale with each meal's share of the target, and each day is
   97–103 % of the target, averaging 100 %. It is activated through the real
   `activateNutritionPlan` transaction with the production PlanValidationPolicy
   registry, so it is persisted only because the signed `target-alignment` v1
   policy accepts it. Provenance is `source: "generated"`,
   `generationRequestId: null`, validation `target-alignment` v1 `accepted`.
4. Everything is read back through the strict shared schemas (state, target,
   plan), and the seed checks that the plan owns today and no generation
   request exists.

Nothing is recorded, no slot is replaced, and no generation request, AI log,
prompt, provider answer or quota document is created.
`e2e/support/nutritionFixture.test.ts` proves the fixture passes
`nutritionPlanContentSchema` and `target-alignment` v1 for any seed date.

## Running headed, and the optional manual login

Automated login uses the app's own sign-in form with the seeded
email/password; no manual step is needed. For interactive checks:

```bash
npm run e2e:emulators          # terminal 1 — keep running
npm run e2e:seed               # terminal 2 — needs E2E_NUTRITION_PASSWORD in .env.e2e.local
npm run e2e:client             # terminal 2 (or 3)
```

Open `http://127.0.0.1:5180/fitssai-coach/auth/sign-in`, log in as one of the
seeded emails with your local password, then open the Nutrition tab
(`/fitssai-coach/dashboard#/nutrition`). The page carries
`<html data-firebase-emulators="127.0.0.1">`, and the console logs
`[fitssai] Firebase emulator mode …`. Without that marker it is not an E2E
build: do not log in. Re-run `npm run e2e:seed` at any time for a clean state.

## Physical phone on the same LAN

1. Put this machine's private LAN address in `.env.e2e.local`:
   `E2E_EMULATOR_HOST=192.168.x.y`. If it is unset, the scripts use the
   machine's only private address and ask you to set it when there are several.
2. `npm run e2e:emulators:lan`. The emulators listen on `0.0.0.0`, from a
   generated, gitignored `firebase.e2e-lan.local` next to `firebase.json`.
3. `npm run e2e:seed`.
4. `npm run e2e:client:lan`. Vite listens on `0.0.0.0:5180`, and the app
   routes to `192.168.x.y:9099/8080/5001`.
5. On the phone (same Wi-Fi) open `http://192.168.x.y:5180/fitssai-coach/`.
   Allow Node and Java through the Windows firewall for *private* networks if
   prompted.

The guard is not weakened for the phone: the project is still `demo-fitssai`,
the flag still explicit, and only private addresses are accepted. Plain HTTP
on a LAN address is not a secure context, so browser features that need one
(service worker/PWA install, Web Crypto `subtle`) may be unavailable on the
phone. Treat that check as layout/interaction QA. Do not commit a LAN address.

## NUT-13A smoke suite (`e2e/tests/nutrition-smoke.e2e.ts`)

1. Adult: sign-in against the Auth emulator; the seeded profile is read from
   the Firestore emulator (name on the profile view; eligible Today). The
   TARGET shows the callable's values, Today shows the seeded three meals, and
   Week shows the seven dates with today marked. Desktop and 390 px screenshots
   are taken.
2. Adult: replace breakfast with another breakfast of the plan, then undo. Both
   go through the real `nutritionUpdateSlot` on the Functions emulator (HTTP 200).
   This proves the server path NUT-13B needs; it is not the replacement
   validation.
3. Isolation account: signs in to its own plan and shows none of A's meals.
4. `nutritionRequestPlan` answers `NUTRITION_AI_DISABLED`. No generation
   request, `_ai_operations`, `_ai_logs` or `_ai_quota` document exists, and
   the state is unchanged.

Every browser test aborts and records any request to a non-local host (the
web font excepted), fails if there is one, and asserts the page reached the
Auth and Firestore emulators (and Functions where used).

## Reload consistency (NUT-13B-FIX-01)

The account's query cache is persisted to localStorage so the app renders at
once and offline. It is an acceleration, never the authority:

- **Saves are flushed.** Saves stay throttled to one a second. The waiting
  snapshot is written synchronously on `pagehide` and when the page becomes
  hidden, so a reload never restores a snapshot older than memory
  (`createAccountPersister` in `src/lib/queryPersistence.ts`).
- **Restored reads are refetched.** Right after restoring, before any query
  subscribes, every restored read is marked stale without fetching or
  removing it (`invalidateRestoredQueries`). Online, a mounted query shows
  the restored data and refetches it. Offline, the fetch waits for the
  network and the restored data stays.

`e2e/tests/nutrition-reload-cache.e2e.ts` covers reloads right after a
recording (at commit time and once shown), a replacement (and a recording
made after it, which must store the replacement), and a profile save. It
also covers a change made on another device while this device's stored read
is seconds old. Each test first checks that the stored read is still the old
one, so the reload really races the save. These tests use the per-test
reseed and network-guard fixture in `e2e/support/fixtures.ts` and strict
emulator reads (`e2e/support/nutritionState.ts`).

## NUT-13B product validation suite

NUT-13B uses this harness, without a second environment or fixture system, to
validate Nutrition V2 itself. Every file under `e2e/tests/nutrition-*.e2e.ts`
other than the smoke suite imports `test` from `e2e/support/fixtures.ts`:

| Fixture | What it does |
| --- | --- |
| `seed` (auto) | Resets and re-seeds the emulators with the NUT-13A seed before **every** test, so no test depends on another's mutations or on the run order. `workers: 1` stays. The smoke file re-seeds once in `beforeAll`. |
| `network` (auto) | The NUT-13A network guard on the test's context. After the test it fails on any request that left the local boundary (web font excepted), or any emulator request that names the production project. A per-test summary goes to `e2e/results.local/evidence/network/`. |
| `persisted(uid)` | Reads the account's `users/{uid}` and every Nutrition V2 collection from the Firestore emulator with the emulator Admin SDK (`e2e/support/emulatorAdmin.ts`), parsed through the strict shared schemas (`e2e/support/nutritionState.ts`). |

UI steps go through the app's own buttons, sheets and accessible names
(`e2e/support/nutritionUi.ts`); no production code was changed for selectors.

| File | Scenarios |
| --- | --- |
| `nutrition-recording.e2e.ts` | Record today's planned breakfast: UI planned → recorded, the entry equals the effective planned meal snapshot, and the base plan, TARGET, state, other slots and dates are unchanged. Covers normal reload, hard reload and reopening through the bottom navigation. Snapshot immutability across refresh, reload, a permitted replacement of another slot, and another device's removal (a tombstone keeps its snapshot). TARGET/Today/Week: seven ordered dates, today marked, day status unrecorded → partial → recorded, TARGET fixed. |
| `nutrition-replacement.e2e.ts` | Replace today's breakfast through the sheet and `nutritionUpdateSlot`: one slot head for that plan+date+slot at revision 1, the base plan unchanged, other slots and days unchanged, nothing recorded, survives reload. Undo gives revision 2, selection base, one override in history, two distinct request ids, and survives reload. Recording vs replacement: the recorded snapshot is the replaced meal. The UI blocks both Ersetzen and Rückgängig. The server refuses a direct undo or commit with `SLOT_HAS_RECORD` (also for a recorded base meal), and a stale revision with `STALE_REVISION` first. A tombstone releases the slot, as NUT-10 specifies. |
| `nutrition-offline.e2e.ts` | `context.setOffline(true)` (Chromium reports `navigator.onLine === false` and fires the real events, so no helper is needed). One recording gives exactly one queued `NUTRITION_ENTRY_WRITE` intent. The UI says "Lokal gespeichert – wird synchronisiert", nothing is on the server, and replacement is blocked. Back online, the app's own replay writes the same intent once and the queue drains. Further offline/online transitions, the 5 s retry interval, and a re-inserted copy of the replayed queue entry (an interrupted cleanup) cause no second revision. The flow stays in one document; reload preserves the result. |
| `nutrition-account-isolation.e2e.ts` | One document from start to end. A records breakfast online and queues lunch offline, then signs out through Profil → Abmelden. B signs in on the same page: B's TARGET, plan and meals, none of A's names, recordings, pending changes or conflicts, and nothing of A in B's persisted cache. B's replay never touches A's queued entry, and B gets no entries. A signs back in: A's data is intact, and A's queued lunch replays as A with its original intent. |
| `nutrition-eligibility.e2e.ts` | Missing age and minor: no Nutrition V2 read at all from the browser, no target, slots, week, recording, replacement or refresh. The server refuses `nutritionSetTarget` and `nutritionUpdateSlot` with `NOT_ELIGIBLE` (`permission-denied`, with the reason). `nutritionRequestPlan` answers the closed AI gate. A rules-valid entry write is denied (a control shows the adult may write it). Missing age: the age is completed through the profile sheet (out-of-range refused), the account becomes eligible (the "profile complete" empty state), only `age` changed and no V2 document was created. |
| `nutrition-responsive.e2e.ts` | 320, 375 and 390 px as a touch device. The **required** functional check: no horizontal scroll; TARGET, slots, both slot actions, week rows and the four navigation tabs sit inside the viewport; the last week row scrolls clear of the bottom navigation; the recording and replacement sheets fit and are completed by taps; Undo works; Profil → Nutrition works. A separate label **diagnostic** measures every sheet label for clipping. At 320 px it is marked `test.fail` for the known "Ausgelassen" issue (see below). |
| `nutrition-reload-cache.e2e.ts` | From NUT-13B-FIX-01 (above): a reload immediately after a recording, a replacement (and a recording made after it) or a profile save, and after another device's change. |

No scenario waits for the persisted cache before reloading; every reload
follows the action immediately. Screenshots are written to
`e2e/results.local/screenshots/nut13b-*.png`, and evidence JSON to
`e2e/results.local/evidence/`. Run one file with
`npx tsx e2e/scripts/run.ts nutrition-offline` (or `--attach` / `--headed`).

### NUT-13B result (2026-09-29, base `main` 1959ae4)

**Automated product validation: PASS.** All required scenarios pass.

| Run | Result |
| --- | --- |
| `npm run e2e:nutrition` (headless) | 25 passed, exit 0 |
| `npm run e2e:nutrition:headed` | 25 passed, exit 0 |
| LAN-routed attach run (Auth, Firestore and Functions on this machine's WLAN address) | 25 passed, exit 0 |

The 25 tests are the 4 NUT-13A smoke tests, 5 FIX-01 reload regressions and
16 NUT-13B tests. The 320 px label diagnostic counts as passed because it is
an expected failure.

Network evidence (the per-test fixture), in every run:

- 0 blocked requests.
- Local runs: traffic only to `127.0.0.1` on 5180 (client), 9099 (Auth),
  8080 (Firestore) and 5001 (Functions).
- LAN run: Firebase traffic only to the WLAN emulator host.
- No emulator request named the production project.
- The run logs mention no Vertex or Gemini endpoint.

Validated:

- **Recording.** Planned is not consumed, and only an explicit action
  records. The snapshot equals the effective planned meal: one entry,
  revision 1, one intent. The base plan, TARGET, state, other slots and dates
  are unchanged. The result persists across an immediate reload, a hard
  reload and a reopen.
- **Recorded snapshot.** Unchanged by refresh, reloads, another slot's
  replacement and another device's removal. The tombstone keeps it.
- **Replacement.** Only today's slot for that date: one head at revision 1,
  the base plan unchanged, nothing recorded, survives an immediate reload.
- **Undo.** Revision 2, selection base, one override in history, two distinct
  request ids, survives reload.
- **Recording vs replacement.** The recorded snapshot is the effective
  (replaced) meal. The UI blocks Ersetzen and Rückgängig. The server answers
  `SLOT_HAS_RECORD` (`FAILED_PRECONDITION`), including for a recorded base
  meal, and `STALE_REVISION` (`ABORTED`, with `currentRevision`) for a stale
  revision. A tombstone releases the slot.
- **Offline → online.** One queued intent and nothing on the server. The same
  intent id is applied once and the queue drains. Later transitions, the
  retry interval and a re-inserted replayed entry cause no second revision.
  An immediate reload keeps the result.
- **One-browser A → B → A.** B sees none of A's data, pending changes or
  cache. A's queued entry never replays as B. A's data is intact, and A's
  queued entry replays as A.
- **Missing age.** No V2 reads before completion. Out-of-range input is
  refused. Saving age 30 makes the account eligible, and an immediate reload
  shows the saved server state. Only `age` changed.
- **Minor.** No V2 read or surface. The server answers `NOT_ELIGIBLE`
  (`PERMISSION_DENIED`) for target and slot, and the rules deny entry writes.
- **TARGET / Today / Week.** The target is stable; seven ordered dates with
  today marked; replacement moves only today's planned kcal; recording
  changes only the day's recorded status.
- **FIX-01, re-verified in the full suite with no delays:**
  - Recording → immediate reload: pass.
  - Replacement → immediate reload: pass.
  - Replacement → reload → recording: stores the replacement, never the base
    meal.
  - Missing age → save → immediate reload: pass.
  - Another device's change → reload: pass.
- **320 / 375 / 390 px:** the required functional checks pass at every width.

**Known non-functional issue: 320 px label polish.** At 320 px, the
recording sheet's "Ausgelassen" mode label is about 10 px wider than its
button and renders clipped. The button still works, and the functional check
at 320 px passes. The diagnostic is an explicit expected failure
(`test.fail`) at 320 px, and it passes at 375 and 390 px. It will report
"expected to fail, but passed" once the label fits. It is not fixed in
NUT-13B.

Other notes:

- At 320 px, week rows wrap the date into four or five lines, but nothing is
  clipped.
- Outside Nutrition, the sign-in flow navigates to `/dashboard` twice (on the
  auth state, then from a 1.5 s success timer), so a tab chosen within that
  window loses its URL hash. `submitSignIn` waits for the second navigation.

History:

- NUT-13B first found the stale persisted-read defect, which is now fixed:
  NUT-13B-FIX-01 (PR #128) is merged.
- Harness fixes that came with it are in main:
  - The E2E dev server ignores `e2e/results.local`.
  - `runNutritionSeed` reseeds before every test.
  - The emulator Admin reader is shared with the seed.

### Physical phone check — pending

A real phone has not been used, so **NUT-13 is not passed**. Recording,
replacement, extra meals and the offline queue create ids with
`crypto.randomUUID()`, which a browser offers only in a secure context.
`http://<lan-address>:5180` is not one, so those actions fail on a phone that
opens the LAN address. Production (HTTPS) is not affected.

Use a loopback origin: an Android phone on USB with debugging enabled, and
`adb reverse`. The phone then opens `http://localhost:5180`, a secure context,
and its ports are forwarded to this machine's loopback emulators.

Set `E2E_NUTRITION_PASSWORD` in `.env.e2e.local` first. Then, in terminal 1
(keep it running):

```bash
npm run e2e:emulators
```

In terminal 2:

```bash
npm run e2e:seed
```

```bash
npm run e2e:client
```

In terminal 3, with the phone connected:

```bash
adb reverse tcp:5180 tcp:5180 && adb reverse tcp:9099 tcp:9099 && adb reverse tcp:8080 tcp:8080 && adb reverse tcp:5001 tcp:5001
```

Then open `http://localhost:5180/fitssai-coach/auth/sign-in` in Chrome on the
phone. Without USB, the LAN setup above is only for layout and navigation;
recording and replacement need the loopback route. Re-run `npm run e2e:seed`
for a clean state.

Checklist, on the LOCAL emulator adult account only (never GitHub Pages or
production). The page must carry `data-firebase-emulators`.

1. Sign in as `nutrition-adult@fitssai-e2e.test`.
2. TARGET renders (2.728 kcal on the seed).
3. Today renders.
4. Week renders.
5. The recording sheet opens and saves.
6. The replacement sheet opens and replaces.
7. Undo works.
8. An immediate reload after an action keeps the state.
9. Nothing is clipped horizontally in a way that stops an action.
10. The bottom navigation is usable.
11. Profil → Ernährungsplan works.

Status:

- NUT-13A harness: COMPLETE.
- NUT-13B-FIX-01: MERGED (PR #128).
- NUT-13B automated product validation: PASS.
- 320 px "Ausgelassen" label: a known non-functional polish issue, open.
- Physical phone check: PENDING.
- NUT-13: not passed until the phone check.
