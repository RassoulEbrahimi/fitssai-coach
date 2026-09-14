/** Static product content. Matching/coverage and review sources: docs/exercise-guidance.md. */
export const muscleLabels = {
  chest: 'Brustmuskulatur',
  triceps: 'Trizeps',
  frontShoulders: 'Vordere Schultern',
  lats: 'Breiter Rückenmuskel',
  upperBack: 'Oberer Rücken',
  biceps: 'Bizeps',
  abs: 'Gerade Bauchmuskulatur',
  deepAbs: 'Tiefe Bauchmuskulatur',
  obliques: 'Seitliche Bauchmuskulatur',
  shoulderStabilizers: 'Schulterstabilisatoren',
} as const;

export type MuscleGroup = keyof typeof muscleLabels;
export interface ExerciseDetail {
  readonly canonicalKey: string;
  readonly aliases: readonly string[];
  readonly title: string;
  /** Bundled asset imports only; no external URLs. */
  readonly media?: { readonly type: 'image'; readonly src: string; readonly alt: string };
  readonly execution: {
    readonly setup: readonly string[];
    readonly steps: readonly string[];
    readonly cues?: readonly string[];
  };
  readonly muscles: {
    readonly primary: readonly MuscleGroup[];
    readonly secondary: readonly MuscleGroup[];
  };
}

export const exerciseDetails: readonly ExerciseDetail[] = [
  {
    canonicalKey: 'bankdrücken', title: 'Bankdrücken', aliases: ['Bench Press'],
    execution: {
      setup: ['Auf die Flachbank legen und beide Füße fest aufstellen.', 'Schulterblätter stabil an die Bank legen. Die Langhantel etwas weiter als schulterbreit mit umschlossenem Daumen greifen.'],
      steps: ['Die Stange kontrolliert zur Brust absenken. Die Unterarme möglichst senkrecht halten.', 'Die Stange gleichmäßig nach oben drücken; Gesäß und Füße bleiben auf ihrer Auflage.'],
      cues: ['Nicht auf der Brust federn lassen.', 'Eine passende Sicherheitsablage oder eine sichernde Person nutzen.'],
    },
    muscles: { primary: ['chest'], secondary: ['triceps', 'frontShoulders'] },
  },
  {
    canonicalKey: 'liegestütze', title: 'Liegestütze', aliases: ['Push-ups'],
    execution: {
      setup: ['Hände etwas weiter als schulterbreit aufsetzen und auf den Zehenspitzen abstützen.', 'Bauch anspannen und Kopf, Rumpf und Beine in einer Linie halten.'],
      steps: ['Ellbogen beugen und den Körper als Einheit kontrolliert zum Boden absenken.', 'Über die Hände zurück in die Ausgangsposition drücken.'],
      cues: ['Ellbogen schräg nach hinten führen, nicht seitlich abspreizen.', 'Die Hüfte weder durchhängen lassen noch vor dem Oberkörper anheben.'],
    },
    muscles: { primary: ['chest'], secondary: ['triceps', 'frontShoulders', 'abs'] },
  },
  {
    canonicalKey: 'klimmzüge', title: 'Klimmzüge', aliases: ['Pull-up'],
    execution: {
      setup: ['Die Stange im Obergriff etwas weiter als schulterbreit greifen.', 'Den Körper ruhig hängen lassen und den Rumpf anspannen.'],
      steps: ['Die Ellbogen nach unten ziehen und den Körper zur Stange anheben.', 'Kontrolliert wieder absenken, bis die Arme gestreckt sind.'],
      cues: ['Ohne Schwung aus Beinen oder Hüfte arbeiten.', 'Den Kopf nicht nach vorne schieben, um die Stange zu erreichen.'],
    },
    muscles: { primary: ['lats'], secondary: ['upperBack', 'biceps'] },
  },
  {
    canonicalKey: 'plank', title: 'Plank', aliases: ['Planks'],
    execution: {
      setup: ['Unterarme auflegen, Ellbogen unter den Schultern platzieren und Zehenspitzen aufstellen.'],
      steps: ['Rumpf anspannen und den Körper vom Boden anheben.', 'Kopf, Rumpf und Beine in einer Linie halten und ruhig weiteratmen.', 'Zum Beenden die Knie kontrolliert absetzen.'],
      cues: ['Die Hüfte nicht absinken lassen.', 'Die Position lösen, wenn du die Körperspannung nicht mehr halten kannst.'],
    },
    muscles: { primary: ['abs', 'deepAbs'], secondary: ['obliques', 'shoulderStabilizers'] },
  },
  {
    canonicalKey: 'crunches', title: 'Crunches', aliases: [],
    execution: {
      setup: ['Auf den Rücken legen, Knie beugen und Füße aufstellen.', 'Die Hände locker an den Kopf legen, ohne daran zu ziehen.'],
      steps: ['Beim Ausatmen den oberen Rücken langsam vom Boden aufrollen.', 'Den Oberkörper kontrolliert wieder ablegen; der untere Rücken bleibt am Boden.'],
      cues: ['Den Nacken in Verlängerung der Wirbelsäule halten.', 'Mit einer kleinen, ruhigen Bewegung arbeiten, ohne Schwung zu holen.'],
    },
    muscles: { primary: ['abs'], secondary: ['obliques'] },
  },
];

/** Preserve qualifiers, accents and punctuation; only known hyphen variants are equivalent. */
export const normalizeExerciseName = (name: string): string => name
  .normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[‐‑]/g, '-');

// Do not use catalogue classification, substring matching or plan-position IDs here.
const names = new Map(exerciseDetails.map(detail => [normalizeExerciseName(detail.title), detail]));
const aliases = new Map(exerciseDetails.flatMap(detail =>
  detail.aliases.map(alias => [normalizeExerciseName(alias), detail] as const)));

export function resolveExerciseDetail(name: string): ExerciseDetail | undefined {
  const normalized = normalizeExerciseName(name);
  return names.get(normalized) ?? aliases.get(normalized);
}
