/**
 * Push/Pull classification for the exercise catalogue.
 *
 * The catalogue lives in Firestore and only carries a coarse `target_muscle`
 * ("Legs", "Abs", …), which cannot decide Push vs Pull on its own: a leg press
 * and a leg curl are both "Legs" but sit on opposite sides. So classification
 * happens here, in one place, rather than as name checks scattered through the
 * UI.
 *
 * The function is total: every input resolves to exactly one category, so the
 * two filters together always cover the whole catalogue and no exercise can
 * become unreachable — including one whose `target_muscle` this app has never
 * seen.
 */

export type ExerciseCategory = "push" | "pull";

export interface ExerciseCategoryOption {
  id: ExerciseCategory;
  label: string;
}

/** The only two categories the UI offers. Order is the display order. */
export const EXERCISE_CATEGORIES: readonly ExerciseCategoryOption[] = [
  { id: "push", label: "Push" },
  { id: "pull", label: "Pull" },
] as const;

export interface ClassifiableExercise {
  name?: string | null;
  target_muscle?: string | null;
  category?: string | null;
}

const normalize = (value: string | null | undefined): string =>
  (value ?? "")
    .toLowerCase()
    // ß is not an accent and survives NFD, so fold it before stripping marks.
    .replace(/\u00df/g, "ss")
    .normalize("NFD")
    // Strip combining accents so "Rückenstrecker" and "Ruckenstrecker" match.
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/**
 * Exercises whose name defeats the pattern rules. Keys are normalized names.
 * Keep this small — it exists for genuine exceptions, not as the main path.
 */
const NAME_OVERRIDES: Record<string, ExerciseCategory> = {
  // A squat is a pressing pattern even though "Kniebeuge" reads like a curl.
  kniebeuge: "push",
  kniebeugen: "push",
};

/**
 * Ordered rules, most specific first. The first match wins, so anything that
 * could be caught by a broader rule below must appear above it.
 */
const RULES: ReadonlyArray<{ pattern: RegExp; category: ExerciseCategory }> = [
  // --- Unambiguous arm tokens, before the generic "curl"/"press" rules ---
  { pattern: /trizeps|triceps|french|skullcrusher|skull crusher|kickback/, category: "push" },
  { pattern: /bizeps|biceps|preacher|scott|hammer|konzentrations/, category: "pull" },

  // --- Legs: quad-dominant pushes ---
  { pattern: /kniebeug|squat|goblet|hackenschmidt/, category: "push" },
  { pattern: /ausfallschritt|lunge|step.?up|aufsteiger|bulgarian/, category: "push" },
  { pattern: /beinpress|leg.?press|beinstrecker|leg.?extension|quadriz/, category: "push" },
  { pattern: /wadenheben|calf.?raise|waden/, category: "push" },

  // --- Legs / hips: hinge and posterior chain pull ---
  { pattern: /kreuzheben|deadlift|romanian|rdl|good.?morning|nackenziehen/, category: "pull" },
  { pattern: /hip.?thrust|huftheben|huftstoss|glute|gesass|beckenheben|bridge/, category: "pull" },
  { pattern: /beinbeuger|leg.?curl|beincurl|hamstring|ischio|beinbizeps/, category: "pull" },

  // --- Core: posterior before anterior ---
  { pattern: /ruckenstrecker|back.?extension|hyperexten|superman|bird.?dog/, category: "pull" },
  { pattern: /crunch|sit.?up|situp|plank|unterarmstutz|beinheben|leg.?raise|russian|bauchpress|hollow|bauchroller|ab.?wheel|kafigzieher/, category: "push" },

  // --- Upper body pull ---
  { pattern: /klimmzug|pull.?up|chin.?up|lat.?(zug|zieh)|pulldown|latissimus/, category: "pull" },
  { pattern: /rudern|\brow\b|rowing|face.?pull|reverse.?(fly|flye|butterfly)|vorgebeugt/, category: "pull" },
  // "rucken" needs a leading boundary: "bankdrucken" and "schulterdrucken"
  // both contain it mid-word and are pressing movements.
  { pattern: /pullover|uberzug|shrug|nackenheben|kapuzenmuskel|trapez|\brucken|\bback\b/, category: "pull" },

  // --- Upper body push ---
  { pattern: /bankdruck|bench.?press|schulterdruck|overhead|militar|military|arnold/, category: "push" },
  { pattern: /liegestutz|push.?up|pushup|\bdip\b|dips|butterfly|fliegende|\bfly\b|flye|chest/, category: "push" },
  { pattern: /druck|drueck|press|schulter|brust|delt/, category: "push" },

  // --- Generic verbs last: "curl" alone is a pulling motion ---
  { pattern: /curl|zieh|\bpull\b|\bzug\b/, category: "pull" },
  { pattern: /\bpush\b|stoss|strecker/, category: "push" },
];

/** Fallback by muscle group when the name says nothing decisive. */
const MUSCLE_DEFAULTS: Record<string, ExerciseCategory> = {
  chest: "push",
  brust: "push",
  shoulders: "push",
  schultern: "push",
  triceps: "push",
  trizeps: "push",
  quads: "push",
  quadriceps: "push",
  calves: "push",
  waden: "push",
  // Squats, lunges and the leg press are the common "Legs" case.
  legs: "push",
  beine: "push",
  // Anterior core is the common "Abs" case.
  abs: "push",
  bauch: "push",
  core: "push",
  back: "pull",
  rucken: "pull",
  lats: "pull",
  latissimus: "pull",
  biceps: "pull",
  bizeps: "pull",
  hamstrings: "pull",
  beinbizeps: "pull",
  glutes: "pull",
  gesass: "pull",
  traps: "pull",
  trapez: "pull",
  forearms: "pull",
  unterarme: "pull",
  "rear delts": "pull",
};

/**
 * Resolve an exercise to Push or Pull. Never returns undefined: an unknown
 * name with an unknown muscle still lands in a visible category rather than
 * disappearing from both filters.
 */
export const classifyExercise = (exercise: ClassifiableExercise): ExerciseCategory => {
  const name = normalize(exercise?.name);

  const override = NAME_OVERRIDES[name];
  if (override) return override;

  const haystack = `${name} ${normalize(exercise?.category)}`;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }

  const muscle = normalize(exercise?.target_muscle);
  if (muscle && MUSCLE_DEFAULTS[muscle]) return MUSCLE_DEFAULTS[muscle];

  // Last resort. Push is the larger bucket in this taxonomy, and a visible
  // exercise in the "wrong" tab is far better than one in neither.
  return "push";
};

/** True when the exercise belongs in the given filter. */
export const isInCategory = (
  exercise: ClassifiableExercise,
  category: ExerciseCategory
): boolean => classifyExercise(exercise) === category;
