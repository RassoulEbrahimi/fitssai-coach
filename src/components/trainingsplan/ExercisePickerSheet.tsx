import React, { useEffect, useId, useMemo, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import { useExerciseCatalogue, type CatalogueExercise } from "@/hooks/useExerciseCatalogue";
import { formatExerciseMuscleSubtitle } from "@/lib/exerciseMuscleSummary";
import {
  DEFAULT_NEW_PRESCRIPTION,
  buildNewExercise,
  searchCatalogue,
  similarCatalogueEntries,
  validatePrescription,
  type PrescriptionDraft,
} from "@/lib/trainingsplanEdit";
import type { Exercise } from "@/lib/types";

export type PickerMode =
  | { kind: "replace"; exerciseIndex: number; exerciseName: string }
  | { kind: "add" };

interface ExercisePickerSheetProps {
  /** Null while closed. */
  mode: PickerMode | null;
  /** Names already on the day; left out of the suggestions. */
  dayExerciseNames: readonly string[];
  onClose: () => void;
  onReplace: (exerciseIndex: number, name: string) => void;
  onAdd: (exercise: Exercise) => void;
}

/** The catalogue's English muscle labels, in the words the app uses. */
const CATALOGUE_MUSCLES: Record<string, string> = {
  Chest: "Brust", Back: "Rücken", Legs: "Beine", Shoulders: "Schultern",
  Triceps: "Trizeps", Biceps: "Bizeps", Abs: "Bauch",
};

const muscleLine = (entry: CatalogueExercise): string | null =>
  formatExerciseMuscleSubtitle(entry.name) ??
  (entry.targetMuscle ? CATALOGUE_MUSCLES[entry.targetMuscle] ?? entry.targetMuscle : null);

const CatalogueList: React.FC<{
  label: string;
  entries: readonly CatalogueExercise[];
  onPick: (entry: CatalogueExercise) => void;
}> = ({ label, entries, onPick }) => {
  const headingId = useId();
  return (
    <section className="tp-pick-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="tp-eyebrow">{label}</h3>
      <ul className="tp-pick-list">
        {entries.map((entry) => {
          const muscles = muscleLine(entry);
          return (
            <li key={entry.id}>
              <button type="button" className="tp-pick" onClick={() => onPick(entry)}>
                <span className="tp-pick-name tp-ellipsis">{entry.name}</span>
                {muscles && <span className="tp-pick-meta tp-ellipsis">{muscles}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/**
 * The Edit Mode's exercise picker, as a bottom sheet over Edit Mode.
 *
 * Replace: names the exercise being replaced, offers catalogue entries for the
 * same main muscle group (only where the repository's reviewed muscle data
 * knows the exercise) and the searchable catalogue. Nothing changes until an
 * entry is chosen; choosing it is the replacement.
 *
 * Add: pick from the catalogue, then confirm sets, reps and rest - prefilled
 * with the existing add form's defaults - before anything is appended.
 */
export const ExercisePickerSheet: React.FC<ExercisePickerSheetProps> = ({
  mode,
  dayExerciseNames,
  onClose,
  onReplace,
  onAdd,
}) => {
  const open = mode !== null;
  const catalogue = useExerciseCatalogue(open);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<CatalogueExercise | null>(null);
  const [draft, setDraft] = useState<PrescriptionDraft>({ ...DEFAULT_NEW_PRESCRIPTION });
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();
  const errorId = useId();

  // Every opening starts clean.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setChosen(null);
    setDraft({ ...DEFAULT_NEW_PRESCRIPTION });
    setError(null);
  }, [open, mode]);

  const entries = useMemo(() => catalogue.data ?? [], [catalogue.data]);
  // Replacing an exercise with itself would change nothing but its load.
  const replacedName = mode?.kind === "replace" ? mode.exerciseName.trim().toLowerCase() : null;
  const results = useMemo(
    () => searchCatalogue(entries, search).filter((entry) => entry.name.toLowerCase() !== replacedName),
    [entries, search, replacedName]
  );
  const suggestions = useMemo(
    () => (mode?.kind === "replace" && !search.trim()
      ? similarCatalogueEntries(mode.exerciseName, entries, dayExerciseNames)
      : []),
    [mode, search, entries, dayExerciseNames]
  );

  const pick = (entry: CatalogueExercise) => {
    if (!mode) return;
    if (mode.kind === "replace") {
      onReplace(mode.exerciseIndex, entry.name);
      onClose();
      return;
    }
    setChosen(entry);
  };

  const submitNew = (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    const problem = validatePrescription(draft);
    setError(problem);
    if (problem) return;
    onAdd(buildNewExercise(chosen.name, draft));
    onClose();
  };

  const field = (key: keyof PrescriptionDraft, label: string, inputMode: "numeric" | "text") => (
    <label className="tp-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={draft[key]}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => { setDraft((current) => ({ ...current, [key]: event.target.value })); setError(null); }}
      />
    </label>
  );

  const title = mode?.kind === "replace" ? "Übung ersetzen" : "Übung hinzufügen";
  const description = mode?.kind === "replace"
    ? <>Ersetzt <b>{mode.exerciseName}</b>. Sätze, Wiederholungen und Pause bleiben.</>
    : chosen ? "Lege fest, wie du sie trainierst." : "Wird am Ende dieses Tages angefügt.";

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={title}
      description={description}
      footer={chosen ? (
        <div className="tp-sheet-actions">
          <button type="button" className="tp-secondary" onClick={() => { setChosen(null); setError(null); }}>
            <ChevronLeft aria-hidden="true" />
            Zurück
          </button>
          <button type="submit" form="tp-add-form" className="tp-cta">Hinzufügen</button>
        </div>
      ) : undefined}
    >
      {chosen ? (
        <form id="tp-add-form" className="tp-add-form" onSubmit={submitNew} noValidate>
          <p className="tp-add-name">{chosen.name}</p>
          <div className="tp-field-row">
            {field("sets", "Sätze", "numeric")}
            {field("reps", "Wdh.", "text")}
            {field("rest", "Pause", "text")}
          </div>
          {error && <p id={errorId} className="tp-field-error" role="alert">{error}</p>}
        </form>
      ) : (
        <>
          <div className="tp-search">
            <Search aria-hidden="true" />
            <label htmlFor={searchId} className="sr-only">Übung suchen</label>
            <input
              id={searchId}
              type="search"
              inputMode="search"
              placeholder="Übung suchen"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {catalogue.isLoading ? (
            <p className="tp-meta" role="status">Übungen werden geladen …</p>
          ) : catalogue.isError ? (
            <div className="tp-notice" role="alert">
              <span>Der Übungskatalog konnte nicht geladen werden.</span>
              <button type="button" className="tp-secondary" onClick={() => catalogue.refetch()}>Erneut versuchen</button>
            </div>
          ) : (
            <>
              {suggestions.length > 0 && (
                <CatalogueList label="Ähnliche Übungen" entries={suggestions} onPick={pick} />
              )}
              {results.length > 0 ? (
                <CatalogueList label={search.trim() ? "Suchergebnisse" : "Alle Übungen"} entries={results} onPick={pick} />
              ) : (
                <p className="tp-meta" role="status">Keine Übung gefunden.</p>
              )}
            </>
          )}
        </>
      )}
    </BottomSheet>
  );
};

export default ExercisePickerSheet;
