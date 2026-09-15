import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WorkoutSummaryModal from "./WorkoutSummaryModal";
import type { RecordedExercisePerformance } from "@/lib/workoutExecution";
import type { PreviousExercisePerformance } from "@/lib/previousPerformance";

const renderSummary = (completed: number[], recordedPerformance?: RecordedExercisePerformance[], previous?: PreviousExercisePerformance) =>
  render(
    <WorkoutSummaryModal
      open
      onClose={vi.fn()}
      onFinish={vi.fn()}
      exercises={[
        { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg", rest: "90s" },
        { name: "Plank", sets: 2, reps: "30 Sekunden", rest: "60s" },
      ]}
      duration={1500}
      workoutName="Push"
      selectedDate={new Date("2026-09-07")}
      getCompletedSetsCount={(index) => completed[index] ?? 0}
      recordedPerformance={recordedPerformance}
      getPreviousExercise={() => previous}
    />
  );

const recordedSection = () => screen.getByRole("region", { name: "Erfasste Leistung" });

describe("WorkoutSummaryModal truthful stats", () => {
  it("names a pending confirmation and counts only fully completed exercises", () => {
    renderSummary([1, 2]);
    const dialog = screen.getByRole("dialog", { name: "Training abschließen?" });
    expect(dialog).toHaveTextContent("Übungen abgeschlossen1 von 2");
    expect(dialog).toHaveTextContent("3/5");
    expect(dialog).toHaveTextContent("Speichere, um das Training zu beenden.");
    expect(dialog).toHaveTextContent("07.09.2026");
  });
  it("shows completion facts from ticked sets", () => {
    renderSummary([3, 2]);
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("25:00");
    expect(dialog).toHaveTextContent("5/5");
    expect(dialog).toHaveTextContent("2 von 2");
    expect(dialog).toHaveTextContent("100%");
  });

  it("does not claim total reps or load derived from the prescription", () => {
    renderSummary([3, 0]);
    const dialog = screen.getByRole("dialog");

    expect(screen.queryByText("Reps")).not.toBeInTheDocument();
    expect(screen.queryByText("Last")).not.toBeInTheDocument();
    // 3 × 8 reps, 3 × 8 × 60 kg, or a stand-in zero would all be fabricated.
    expect(dialog.textContent).not.toMatch(/kg/);
    expect(dialog.textContent).not.toMatch(/\b24\b|1\.440|\b36\b|2\.160/);
    expect(dialog).toHaveTextContent("3/5");
  });

  it("says truthfully that reps and weight are only saved when entered, and lists none when none were", () => {
    renderSummary([1, 0], []);

    expect(screen.getByText(/Wiederholungen und Gewicht werden nur gespeichert, wenn du sie selbst einträgst/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Erfasste Leistung" })).not.toBeInTheDocument();
    expect(screen.queryByText(/nicht erfasst/)).not.toBeInTheDocument();
  });
});

describe("WorkoutSummaryModal factual comparison", () => {
  it("shows dated, labelled facts and neutral German deltas, including open sets", () => {
    renderSummary([1, 0], [{ exerciseIndex: 0, name: "Bankdrücken", sets: [
      { setNumber: 1, reps: 8, weightKg: 52.5, completed: true },
      { setNumber: 2, reps: 12, weightKg: null, completed: false },
      { setNumber: 3, reps: null, weightKg: 45, completed: false },
    ] }], { workoutDay: "2026-09-08", sets: {
      1: { reps: 10, weightKg: 50 }, 2: { reps: 10, weightKg: 50 }, 3: { reps: 10, weightKg: 50 },
    } });
    const section = screen.getByRole("region", { name: "Vergleich zum letzten Mal" });
    expect(within(section).getByRole("heading", { name: "Bankdrücken", level: 4 })).toBeInTheDocument();
    expect(within(section).getAllByText("Letztes Mal · 08.09.2026")).toHaveLength(1);
    expect(within(section).getByRole("heading", { name: "Satz 2 · offen" })).toBeInTheDocument();
    for (const delta of ["Wdh. -2", "Gewicht +2,5 kg", "Wdh. +2", "Gewicht -5 kg"]) {
      expect(within(section).getByText(delta)).toBeInTheDocument();
    }
    expect(within(section).getAllByText("Heute")).toHaveLength(3);
    expect(section.textContent).not.toMatch(/besser|schlechter|Fortschritt|stärker|schwächer|Rekord|PR|Score/i);
    expect(section.querySelector('[aria-live], [role="status"]')).toBeNull();
  });

  it("keeps equal values visible without an evaluative or zero delta badge", () => {
    renderSummary([1, 0], [{ exerciseIndex: 0, name: "Bankdrücken", sets: [
      { setNumber: 1, reps: 10, weightKg: 50, completed: true },
    ] }], { workoutDay: "2026-09-08", sets: { 1: { reps: 10, weightKg: 50 } } });
    const section = screen.getByRole("region", { name: "Vergleich zum letzten Mal" });
    expect(within(section).getAllByText("10 Wdh. · 50 kg")).toHaveLength(2);
    expect(section.textContent).not.toMatch(/±0|\+0|-0|Fortschritt/);
  });

  it.each([undefined, { workoutDay: "2026-09-08", sets: { 1: { reps: null, weightKg: 50 } } }])(
    "omits the comparison section when no directly comparable metric exists", (previous) => {
      renderSummary([1, 0], [{ exerciseIndex: 0, name: "Bankdrücken", sets: [
        { setNumber: 1, reps: 10, weightKg: null, completed: true },
      ] }], previous);
      expect(screen.queryByRole("region", { name: "Vergleich zum letzten Mal" })).toBeNull();
      expect(screen.queryByText(/Keine Daten|Keine Fortschritte/)).toBeNull();
      expect(screen.getByRole("button", { name: "Training speichern & beenden" })).toBeEnabled();
    },
  );
});

describe("WorkoutSummaryModal recorded performance", () => {
  it("lists explicitly recorded reps and weight set by set", () => {
    renderSummary([2, 0], [{
      exerciseIndex: 0,
      name: "Bankdrücken",
      sets: [
        { setNumber: 1, reps: 10, weightKg: 52.5, completed: true },
        { setNumber: 2, reps: 8, weightKg: 55, completed: true },
      ],
    }]);

    const section = recordedSection();
    expect(within(section).getByText("Bankdrücken")).toBeInTheDocument();
    expect(within(section).getByText("Satz 1 · 10 Wdh. · 52,5 kg")).toBeInTheDocument();
    expect(within(section).getByText("Satz 2 · 8 Wdh. · 55 kg")).toBeInTheDocument();
  });

  it("shows only what was recorded and never fills in the prescription", () => {
    renderSummary([1, 0], [{
      exerciseIndex: 0,
      name: "Bankdrücken",
      sets: [
        { setNumber: 1, reps: 10, weightKg: null, completed: true },
        { setNumber: 3, reps: null, weightKg: 57.5, completed: false },
      ],
    }]);

    const section = recordedSection();
    expect(within(section).getByText("Satz 1 · 10 Wdh.")).toBeInTheDocument();
    expect(within(section).getByText("Satz 3 · 57,5 kg · offen")).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/60 kg|8–12|Satz 2|Plank/);
    // No totals, estimates or records.
    expect(screen.getByRole("dialog").textContent).not.toMatch(/Tonnage|1RM|Rekord|Gesamt/);
  });
});
