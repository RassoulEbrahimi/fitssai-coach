/** Exact identity normalization; qualifiers, accents and punctuation stay significant. */
export const normalizeExerciseName = (name: string): string => name
  .normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[‐‑]/g, '-');
