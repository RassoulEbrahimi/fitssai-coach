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

## NUT-13A vs NUT-13B

**NUT-13A (this slice):** emulator config, the fail-closed browser and Node
guards, the credential-free emulator process, the deterministic seed/reset,
Playwright, the smoke suite above, and these docs.

**NUT-13B (next, on this harness):** the product validation. That covers
recording, and recorded persistence after reload. It covers replacement and
undo semantics (date+slot scope, revision, blocked after recording). It covers
offline → online reconciliation (`context.setOffline`) and account
switching/isolation in one browser. It also covers narrow/mobile viewports
(320/375/390 px) and a final physical-phone pass over the LAN. Product bugs
found there are reported and fixed in separate PRs.
