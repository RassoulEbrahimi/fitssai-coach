# TRAINING-UI-01B — Exercise thumbnail asset pack

TRAINING-UI-01 built the thumbnail architecture and shipped no artwork: one temporary bench-press graphic, and a monogram fallback everywhere else. This change replaces that with an original local vector pack, so every exercise identity the repository knows resolves to an exercise-specific image.

Presentation only. Workout session identity, set completion, actual performance, previous performance, `Übernehmen`, rest, guidance, the completion summary and the finish flow are untouched, and so is the TRAINING-UI-01 card layout. The only component change is a dark-mode filter on the thumbnail image.

## Coverage

**72 of 72 known identities (100%), on 51 assets.** No known identity falls back.

The production catalogue lives in Firestore, so a name outside this inventory can still reach the UI. Those keep the deterministic monogram fallback, which is the intended behaviour and is still tested.

## Known-identity inventory

`src/test/knownExerciseIdentities.ts` is the reviewed list, rebuilt from source for this change rather than carried over. It is test-only and never bundled.

**A name is in the inventory when it is used as exercise data:**

- the production lists: `src/lib/exerciseFields.ts`, `src/lib/exerciseGuidance.ts`;
- plan, session and execution fixtures, including `functions/src/plan.fixtures.ts` and the Functions plan-generation tests;
- catalogue rows and classifier inputs (`exerciseCategories.test.ts`), editor fixtures (`exerciseEditorTestUtils.ts`, `exerciseFields.test.ts`), the Firestore rules seed;
- the three TRAINING-UI-01 long names;
- `Unterarmstütz`, carried over from the TRAINING-UI-01 inventory; it is also a classifier keyword in `exerciseCategories.ts`.

**A name is excluded when it is not an identity:**

| Excluded | Why | Examples |
| --- | --- | --- |
| Spelling, case, whitespace and composition probes | They normalise onto a covered identity, or exist to prove the normaliser folds them | `bankdruecken`, `Schrägbank Drücken`, `Bankdrucken`, `Pushups`, `  Row  ` |
| Placeholders | Not exercises | `Unbekannte Übung`, `Maschine A`, `Übung 1`, `Bank`, `Klimm` |
| Resolver near-miss probes | They exist so a test can prove a resolver does **not** match them | `Bench Press Machine`, `Push-ups auf Knien`, `Side Plank`, `Crunch`, `Chin-up`, `Bankdrücken eng`, `Bench Press close grip` |
| Functions equipment-inference probes | Inputs to `impliedEquipment`, not plan or catalogue names | `Kettlebell-Swing`, `Kabelzug-Rudern`, `Widerstandsbänder-Rudern`, `Klimmzug`, `Latzüge` |
| Classifier stems and calorie keywords | Fragments, not names | `press`, `curl`, `liegestütz`, `rowing` |

The inventory is 64 names from the TRAINING-UI-01 table plus eight the old table missed: `Einarmiges Kabelrudern am Seilzug`, `Seitheben am Kabelzug`, `Laufen im Gelände`, `Lockerer Dauerlauf`, `Intervalllauf`, `Kurzhantel-Schulterdrücken`, `Kurzhantel-Rudern`, `Langhantel-Kniebeuge`.

## Canonical movements and aliases

`src/lib/exercisePresentation.ts` stays the single presentation registry: exact-name lookup, explicit aliases, no fuzzy or substring matching, no dependency on guidance.

An entry is one physical movement. **An alias is only a translation, a plural or an intensity variant of the same movement on the same equipment.** Anything that changes the angle, grip, machine or implement gets its own entry and its own artwork.

| Asset | Identities |
| --- | --- |
| `bench-press.svg` | Bankdrücken, Bench Press |
| `close-grip-bench-press.svg` | Bankdrücken enger Griff |
| `incline-bench-press.svg` | Schrägbankdrücken |
| `incline-smith-bench-press.svg` | Bankdrücken schräg Multipresse |
| `push-up.svg` | Liegestütze, Push-ups |
| `butterfly.svg` | Butterfly |
| `dips.svg` | Dips |
| `overhead-press.svg` | Schulterdrücken, Overhead Press |
| `dumbbell-shoulder-press.svg` | Kurzhantel-Schulterdrücken |
| `lateral-raise.svg` | Seitheben |
| `cable-lateral-raise.svg` | Seitheben am Kabelzug |
| `reverse-butterfly.svg` | Reverse Butterfly |
| `face-pull.svg` | Face Pull |
| `pull-up.svg` | Klimmzüge, Pull-up, Pull-ups |
| `lat-pulldown.svg` | Latziehen, Latzug, Lat Pulldown |
| `seated-cable-row.svg` | Rudern, Row |
| `barbell-row.svg` | Barbell Row |
| `dumbbell-row.svg` | Kurzhantel-Rudern |
| `single-arm-cable-row.svg` | Einarmiges Kabelrudern am Seilzug |
| `dumbbell-pullover.svg` | Überzüge |
| `back-extension.svg` | Rückenstrecker, Back Extension |
| `superman.svg` | Superman |
| `good-morning.svg` | Good Morning |
| `squat.svg` | Kniebeugen, Kniebeuge, Squat, Langhantel-Kniebeuge |
| `bulgarian-split-squat.svg` | Bulgarian Split Squat |
| `lunge.svg` | Ausfallschritte, Lunges |
| `leg-press.svg` | Beinpresse |
| `leg-press-45-plate-loaded.svg` | Beinpresse 45° Plate Loaded |
| `leg-extension.svg` | Beinstrecker |
| `leg-curl.svg` | Beinbeuger, Leg Curl |
| `calf-raise.svg` | Wadenheben |
| `deadlift.svg` | Kreuzheben, Deadlift |
| `romanian-deadlift.svg` | Rumänisches Kreuzheben |
| `hip-thrust.svg` | Hip Thrust |
| `glute-bridge.svg` | Gesäßbrücke |
| `plank.svg` | Plank, Planks, Unterarmstütz |
| `crunch.svg` | Crunches |
| `sit-up.svg` | Sit-ups |
| `leg-raise.svg` | Beinheben |
| `russian-twist.svg` | Russian Twist, Russian Twists |
| `biceps-curl.svg` | Bizepscurls, Curl |
| `hammer-curl.svg` | Hammercurls |
| `triceps-pushdown.svg` | Trizepsdrücken |
| `triceps-rope-pushdown.svg` | Trizepsstrecken Kabelzug Kordel |
| `running.svg` | Laufen, Lockerer Dauerlauf, Intervalllauf |
| `trail-running.svg` | Laufen im Gelände |
| `cycling.svg` | Radfahren |
| `swimming.svg` | Schwimmen |
| `jump-rope.svg` | Seilspringen |
| `burpee.svg` | Burpees |
| `farmers-walk.svg` | Farmers Walk |

### Grouping decisions worth knowing

- **`Rudern` and `Row`** get the seated horizontal pull. `Rudern` is strength in plans, sessions and the catalogue but cardio in the editor's field list; the seated row is the reading that misleads neither. `Barbell Row`, `Kurzhantel-Rudern` and the single-arm cable row stay separate.
- **`Schulterdrücken` and `Overhead Press`** share the standing barbell press; `Kurzhantel-Schulterdrücken` is a separate seated dumbbell press.
- **`Curl`**, unqualified, shares the dumbbell biceps curl. `Hammercurls` is separate: the grip is the whole difference, so the dumbbells are drawn horizontal versus vertical.
- **`Kniebeugen`, `Kniebeuge`, `Squat` and `Langhantel-Kniebeuge`** share the barbell back squat, which is what the base asset already depicts.
- **`Lockerer Dauerlauf` and `Intervalllauf`** share the run: intensity changes, the movement does not. `Laufen im Gelände` gets its own sloped, uneven ground.
- **Bankdrücken splits four ways** — flat, close grip, incline free barbell and incline Smith — because angle, grip and machine each change the movement.

## Art direction

Original local vector artwork, drawn for this change. Nothing is traced, scraped, downloaded or derived from manufacturer photography, stock imagery or another app.

- **Canvas:** `viewBox="0 0 72 72"`, so one unit is one rendered pixel in the 72×72 surface. Safe area 6–66. Transparent background, no text, no logos, no brand marks.
- **Figure:** a pictogram, not anatomy. Filled head, 6.6-unit torso, 4.6-unit limbs, round caps and joins. No face, no gender cues, no skin tone. The far arm and leg are one step lighter, which is the only depth cue.
- **Equipment:** thinner (2.6) and lighter than the body. Pads are an equipment-coloured body with a lighter inlay. A floor line at y=64 anchors anything standing, so scale reads the same across the pack.
- **Accent:** FitssAI green, reserved for the moving load — plates, dumbbells, handles, ropes, a sled platform. Everything else is neutral.
- **Camera:** side view by default. Front view where the movement is defined by width or symmetry (pull-up, lat pulldown, overhead press, lateral raise, butterfly, dips, curls, pushdowns). `close-grip-bench-press` is the one head-end view, because grip width is invisible from the side.
- **Distinctness:** every asset is a different scene, never a renamed copy. Leg extension is seated with the shins rising, leg curl is lying with the heels rising, leg press is a seated sled, the 45° press is an angled plate-loaded sled, the pulldown pulls a bar down from an overhead pulley, the pull-up hangs from a fixed bar.

### Generator

`scripts/generate-exercise-thumbnails.mjs` holds the pose and equipment primitives plus one scene per movement, and writes the SVGs deterministically:

```bash
node scripts/generate-exercise-thumbnails.mjs
```

The SVG files are the shipped artefacts and are committed. The generator exists so a revision keeps the same stroke language and proportions, and it removes assets whose scene is gone.

## Dark and light mode

The pack is drawn once for the light surface. `ExerciseThumbnail` applies `dark:invert dark:hue-rotate-180` to the image, which is the only component change in this PR.

- Neutral ink inverts to a light neutral, so the figure lifts off the dark tile.
- The accent green survives the round trip: `#16a34a` inverts and rotates back to roughly `#18a54c`, measured in the browser as the computed filter `hue-rotate(180deg) invert(1)`.
- Assets have transparent backgrounds and no light tile of their own, so the themed surface (`bg-muted`) shows through in both themes.
- There is one file per movement; no duplicated light and dark artwork.

## Bundle cost

| | |
| --- | --- |
| Assets | 51 SVG files |
| Directory size | 42,646 B raw, 16,332 B gzipped |
| Largest asset | `incline-smith-bench-press.svg`, 1,138 B |
| `WorkoutView` chunk | 142,199 B → 198,396 B raw (51,009 B gzipped) |
| Precache | 2,793 KiB → 2,848 KiB |

Vite inlines each asset as a data URI, because every file is under the 4 KB `assetsInlineLimit`. That keeps the cost inside the lazily loaded workout chunk and adds no extra requests; nothing was changed in the build config. If the pack grows much larger, emitting the files instead (an `assetsInlineLimit` function) is the lever — they are already in the service worker's precache glob either way.

## Tests

- **`src/lib/exercisePresentation.test.ts`:** every inventory name resolves to a `final` local asset; the whole inventory is covered; no registered name sits outside the inventory; the production name lists stay inside the inventory; reviewed aliases share an asset; twenty variant pairs resolve to different assets; exact matching only; near-miss and unknown names get no entry; fallback identities stay stable; independence from guidance, including that the module does not import it; no duplicates and no remote sources.
- **`src/test/exerciseThumbnailAssets.test.ts`:** one kebab-case SVG per canonical movement; the expected viewBox and no full-bleed background rectangle; no script, `foreignObject`, raster or nested image, external reference, `url()`, embedded data URI, event handler or text; a size cap per file; each asset referenced exactly once, with no orphans.
- **`ExerciseThumbnail.test.tsx`:** decorative and lazy with reserved dimensions; the dark-mode filter classes; the fallback for a name outside the registry; a broken image still falls back without resizing the surface.
- **`ExerciseWithSets.test.tsx`:** a qualified variant gets its own asset rather than the flat bench one, and an unknown name falls back.
- The TRAINING-EXEC-01A–03A and TRAINING-UI-01 suites run unchanged.

## Verification

Checked in the local ignored fixture (`training-ui.local`) with the production CSS, on a seeded day holding one exercise per family plus an unknown name:

- 25 cards, each with a 72×72 surface; 24 resolve to their reviewed asset and `Brustpresse Maschine` — deliberately not in the registry — shows the `BM` monogram fallback;
- every image carries the computed filter `hue-rotate(180deg) invert(1)` in dark mode and none in light;
- no horizontal overflow at 320, 375 or 1280 px, in either theme;
- qualified variants show their own artwork beside the full name: `Bankdrücken` on the flat bench, `Bankdrücken schräg Multipresse` on the Smith incline, `Beinpresse 45° Plate Loaded` on the angled sled, `Trizepsstrecken Kabelzug Kordel` on the rope pushdown.

The pack was also reviewed as a contact sheet at 72 px and 144 px on both muted surfaces, and reworked where an asset did not read: squat, superman, swimming, back extension, crunch and sit-up, russian twist, lunge, plank, calf raise, close-grip bench, split squat and farmers walk.

## Known limitations

- **Generic names are a judgement call.** `Rudern`, `Row`, `Curl` and `Schulterdrücken` carry no equipment qualifier, so their artwork shows the most common gym reading. The name text stays authoritative.
- **`Rudern` is two movements in this product:** a strength row in plans and the rowing ergometer in the editor's cardio field list. The seated row image suits both, but it is not a rowing machine.
- **Grip variants read weakly at 72 px.** Close-grip bench press uses a head-end view to show grip width at all; a chin-up would be near-identical to the pull-up, and is deliberately not registered.
- **Unknown catalogue entries still fall back.** Firestore can serve any name; the monogram plus mosaic stays the safety net, and monograms can collide between exercises.
- **The dark theme is a filter, not separate artwork.** It inverts lightness, so an asset that relied on a specific hue relationship would shift; the pack uses neutrals plus one accent, which survives the round trip.
