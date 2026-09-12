import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkoutSummaryModal from "./WorkoutSummaryModal";

const renderSummary = (completed: number[]) =>
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
    />
  );

describe("WorkoutSummaryModal truthful stats", () => {
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

  it("says plainly that ticking a set does not record reps or weight", () => {
    renderSummary([1, 0]);

    expect(screen.getByText(/Wiederholungen und Gewicht werden dabei nicht erfasst/)).toBeInTheDocument();
  });
});
