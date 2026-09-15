import backExtensionGraphic from '@/assets/exercise-thumbnails/back-extension.svg';
import barbellRowGraphic from '@/assets/exercise-thumbnails/barbell-row.svg';
import benchPressGraphic from '@/assets/exercise-thumbnails/bench-press.svg';
import bicepsCurlGraphic from '@/assets/exercise-thumbnails/biceps-curl.svg';
import bulgarianSplitSquatGraphic from '@/assets/exercise-thumbnails/bulgarian-split-squat.svg';
import burpeeGraphic from '@/assets/exercise-thumbnails/burpee.svg';
import butterflyGraphic from '@/assets/exercise-thumbnails/butterfly.svg';
import cableLateralRaiseGraphic from '@/assets/exercise-thumbnails/cable-lateral-raise.svg';
import calfRaiseGraphic from '@/assets/exercise-thumbnails/calf-raise.svg';
import closeGripBenchPressGraphic from '@/assets/exercise-thumbnails/close-grip-bench-press.svg';
import crunchGraphic from '@/assets/exercise-thumbnails/crunch.svg';
import cyclingGraphic from '@/assets/exercise-thumbnails/cycling.svg';
import deadliftGraphic from '@/assets/exercise-thumbnails/deadlift.svg';
import dipsGraphic from '@/assets/exercise-thumbnails/dips.svg';
import dumbbellPulloverGraphic from '@/assets/exercise-thumbnails/dumbbell-pullover.svg';
import dumbbellRowGraphic from '@/assets/exercise-thumbnails/dumbbell-row.svg';
import dumbbellShoulderPressGraphic from '@/assets/exercise-thumbnails/dumbbell-shoulder-press.svg';
import facePullGraphic from '@/assets/exercise-thumbnails/face-pull.svg';
import farmersWalkGraphic from '@/assets/exercise-thumbnails/farmers-walk.svg';
import gluteBridgeGraphic from '@/assets/exercise-thumbnails/glute-bridge.svg';
import goodMorningGraphic from '@/assets/exercise-thumbnails/good-morning.svg';
import hammerCurlGraphic from '@/assets/exercise-thumbnails/hammer-curl.svg';
import hipThrustGraphic from '@/assets/exercise-thumbnails/hip-thrust.svg';
import inclineBenchPressGraphic from '@/assets/exercise-thumbnails/incline-bench-press.svg';
import inclineSmithBenchPressGraphic from '@/assets/exercise-thumbnails/incline-smith-bench-press.svg';
import jumpRopeGraphic from '@/assets/exercise-thumbnails/jump-rope.svg';
import latPulldownGraphic from '@/assets/exercise-thumbnails/lat-pulldown.svg';
import lateralRaiseGraphic from '@/assets/exercise-thumbnails/lateral-raise.svg';
import legCurlGraphic from '@/assets/exercise-thumbnails/leg-curl.svg';
import legExtensionGraphic from '@/assets/exercise-thumbnails/leg-extension.svg';
import legPress45PlateLoadedGraphic from '@/assets/exercise-thumbnails/leg-press-45-plate-loaded.svg';
import legPressGraphic from '@/assets/exercise-thumbnails/leg-press.svg';
import legRaiseGraphic from '@/assets/exercise-thumbnails/leg-raise.svg';
import lungeGraphic from '@/assets/exercise-thumbnails/lunge.svg';
import overheadPressGraphic from '@/assets/exercise-thumbnails/overhead-press.svg';
import plankGraphic from '@/assets/exercise-thumbnails/plank.svg';
import pullUpGraphic from '@/assets/exercise-thumbnails/pull-up.svg';
import pushUpGraphic from '@/assets/exercise-thumbnails/push-up.svg';
import reverseButterflyGraphic from '@/assets/exercise-thumbnails/reverse-butterfly.svg';
import romanianDeadliftGraphic from '@/assets/exercise-thumbnails/romanian-deadlift.svg';
import runningGraphic from '@/assets/exercise-thumbnails/running.svg';
import russianTwistGraphic from '@/assets/exercise-thumbnails/russian-twist.svg';
import seatedCableRowGraphic from '@/assets/exercise-thumbnails/seated-cable-row.svg';
import singleArmCableRowGraphic from '@/assets/exercise-thumbnails/single-arm-cable-row.svg';
import sitUpGraphic from '@/assets/exercise-thumbnails/sit-up.svg';
import squatGraphic from '@/assets/exercise-thumbnails/squat.svg';
import supermanGraphic from '@/assets/exercise-thumbnails/superman.svg';
import swimmingGraphic from '@/assets/exercise-thumbnails/swimming.svg';
import trailRunningGraphic from '@/assets/exercise-thumbnails/trail-running.svg';
import tricepsPushdownGraphic from '@/assets/exercise-thumbnails/triceps-pushdown.svg';
import tricepsRopePushdownGraphic from '@/assets/exercise-thumbnails/triceps-rope-pushdown.svg';
import { normalizeExerciseName } from './exerciseName';

export interface ExercisePresentation {
  readonly canonicalKey: string;
  readonly aliases: readonly string[];
  readonly thumbnail?: {
    readonly src: string;
    readonly source: string;
    readonly status: 'final' | 'temporary-graphic';
  };
}

/** Provenance for the whole pack: see docs/TRAINING-UI-01B-thumbnail-assets.md. */
const ARTWORK = 'Original local vector artwork, TRAINING-UI-01B';
const artwork = (src: string) => ({ src, source: ARTWORK, status: 'final' as const });

/**
 * Reviewed exact identities only. Independent of guidance and the remote catalogue.
 *
 * An entry is one physical movement. Aliases are translations, plurals and
 * intensity variants of that same movement on the same equipment; a variant that
 * changes the angle, grip, machine or implement gets its own entry and its own
 * artwork. Names are matched exactly, so a name that is not listed here — a
 * future Firestore catalogue entry, say — falls back rather than being guessed.
 */
export const exercisePresentations: readonly ExercisePresentation[] = [
  // --- Chest ---
  { canonicalKey: 'bankdrücken', aliases: ['Bench Press'], thumbnail: artwork(benchPressGraphic) },
  { canonicalKey: 'bankdrücken enger griff', aliases: [], thumbnail: artwork(closeGripBenchPressGraphic) },
  { canonicalKey: 'schrägbankdrücken', aliases: [], thumbnail: artwork(inclineBenchPressGraphic) },
  { canonicalKey: 'bankdrücken schräg multipresse', aliases: [], thumbnail: artwork(inclineSmithBenchPressGraphic) },
  { canonicalKey: 'liegestütze', aliases: ['Push-ups'], thumbnail: artwork(pushUpGraphic) },
  { canonicalKey: 'butterfly', aliases: [], thumbnail: artwork(butterflyGraphic) },
  { canonicalKey: 'dips', aliases: [], thumbnail: artwork(dipsGraphic) },

  // --- Shoulders ---
  { canonicalKey: 'schulterdrücken', aliases: ['Overhead Press'], thumbnail: artwork(overheadPressGraphic) },
  { canonicalKey: 'kurzhantel-schulterdrücken', aliases: [], thumbnail: artwork(dumbbellShoulderPressGraphic) },
  { canonicalKey: 'seitheben', aliases: [], thumbnail: artwork(lateralRaiseGraphic) },
  { canonicalKey: 'seitheben am kabelzug', aliases: [], thumbnail: artwork(cableLateralRaiseGraphic) },
  { canonicalKey: 'reverse butterfly', aliases: [], thumbnail: artwork(reverseButterflyGraphic) },
  { canonicalKey: 'face pull', aliases: [], thumbnail: artwork(facePullGraphic) },

  // --- Back ---
  { canonicalKey: 'klimmzüge', aliases: ['Pull-up', 'Pull-ups'], thumbnail: artwork(pullUpGraphic) },
  { canonicalKey: 'latziehen', aliases: ['Latzug', 'Lat Pulldown'], thumbnail: artwork(latPulldownGraphic) },
  // Generic rowing: the seated horizontal pull, the reading both the strength
  // and the cardio use of "Rudern" stay closest to.
  { canonicalKey: 'rudern', aliases: ['Row'], thumbnail: artwork(seatedCableRowGraphic) },
  { canonicalKey: 'barbell row', aliases: [], thumbnail: artwork(barbellRowGraphic) },
  { canonicalKey: 'kurzhantel-rudern', aliases: [], thumbnail: artwork(dumbbellRowGraphic) },
  { canonicalKey: 'einarmiges kabelrudern am seilzug', aliases: [], thumbnail: artwork(singleArmCableRowGraphic) },
  { canonicalKey: 'überzüge', aliases: [], thumbnail: artwork(dumbbellPulloverGraphic) },
  { canonicalKey: 'rückenstrecker', aliases: ['Back Extension'], thumbnail: artwork(backExtensionGraphic) },
  { canonicalKey: 'superman', aliases: [], thumbnail: artwork(supermanGraphic) },
  { canonicalKey: 'good morning', aliases: [], thumbnail: artwork(goodMorningGraphic) },

  // --- Legs and hips ---
  { canonicalKey: 'kniebeugen', aliases: ['Kniebeuge', 'Squat', 'Langhantel-Kniebeuge'], thumbnail: artwork(squatGraphic) },
  { canonicalKey: 'bulgarian split squat', aliases: [], thumbnail: artwork(bulgarianSplitSquatGraphic) },
  { canonicalKey: 'ausfallschritte', aliases: ['Lunges'], thumbnail: artwork(lungeGraphic) },
  { canonicalKey: 'beinpresse', aliases: [], thumbnail: artwork(legPressGraphic) },
  { canonicalKey: 'beinpresse 45° plate loaded', aliases: [], thumbnail: artwork(legPress45PlateLoadedGraphic) },
  { canonicalKey: 'beinstrecker', aliases: [], thumbnail: artwork(legExtensionGraphic) },
  { canonicalKey: 'beinbeuger', aliases: ['Leg Curl'], thumbnail: artwork(legCurlGraphic) },
  { canonicalKey: 'wadenheben', aliases: [], thumbnail: artwork(calfRaiseGraphic) },
  { canonicalKey: 'kreuzheben', aliases: ['Deadlift'], thumbnail: artwork(deadliftGraphic) },
  { canonicalKey: 'rumänisches kreuzheben', aliases: [], thumbnail: artwork(romanianDeadliftGraphic) },
  { canonicalKey: 'hip thrust', aliases: [], thumbnail: artwork(hipThrustGraphic) },
  { canonicalKey: 'gesäßbrücke', aliases: [], thumbnail: artwork(gluteBridgeGraphic) },

  // --- Core ---
  { canonicalKey: 'plank', aliases: ['Planks', 'Unterarmstütz'], thumbnail: artwork(plankGraphic) },
  { canonicalKey: 'crunches', aliases: [], thumbnail: artwork(crunchGraphic) },
  { canonicalKey: 'sit-ups', aliases: [], thumbnail: artwork(sitUpGraphic) },
  { canonicalKey: 'beinheben', aliases: [], thumbnail: artwork(legRaiseGraphic) },
  { canonicalKey: 'russian twist', aliases: ['Russian Twists'], thumbnail: artwork(russianTwistGraphic) },

  // --- Arms ---
  { canonicalKey: 'bizepscurls', aliases: ['Curl'], thumbnail: artwork(bicepsCurlGraphic) },
  { canonicalKey: 'hammercurls', aliases: [], thumbnail: artwork(hammerCurlGraphic) },
  { canonicalKey: 'trizepsdrücken', aliases: [], thumbnail: artwork(tricepsPushdownGraphic) },
  { canonicalKey: 'trizepsstrecken kabelzug kordel', aliases: [], thumbnail: artwork(tricepsRopePushdownGraphic) },

  // --- Cardio and conditioning ---
  { canonicalKey: 'laufen', aliases: ['Lockerer Dauerlauf', 'Intervalllauf'], thumbnail: artwork(runningGraphic) },
  { canonicalKey: 'laufen im gelände', aliases: [], thumbnail: artwork(trailRunningGraphic) },
  { canonicalKey: 'radfahren', aliases: [], thumbnail: artwork(cyclingGraphic) },
  { canonicalKey: 'schwimmen', aliases: [], thumbnail: artwork(swimmingGraphic) },
  { canonicalKey: 'seilspringen', aliases: [], thumbnail: artwork(jumpRopeGraphic) },
  { canonicalKey: 'burpees', aliases: [], thumbnail: artwork(burpeeGraphic) },
  { canonicalKey: 'farmers walk', aliases: [], thumbnail: artwork(farmersWalkGraphic) },
];

const presentations = new Map(exercisePresentations.flatMap(entry =>
  [entry.canonicalKey, ...entry.aliases].map(name => [normalizeExerciseName(name), entry] as const)));

export function resolveExercisePresentation(name: string): ExercisePresentation | undefined {
  return presentations.get(normalizeExerciseName(name));
}

/** A monogram plus identity-derived mosaic, never a guessed exercise illustration. */
export function exerciseThumbnailFallback(name: string) {
  const identity = resolveExercisePresentation(name)?.canonicalKey ?? normalizeExerciseName(name);
  const words = identity.split(/[\s-]+/u).filter(Boolean);
  const initials = (words.length > 1
    ? words.slice(0, 3).map(word => Array.from(word)[0]).join('')
    : Array.from(identity).slice(0, 2).join('')).toUpperCase() || '?';
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return { identity, initials, pattern: hash >>> 0 };
}
