import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExerciseWithSets from "./ExerciseWithSets";

const idleTimerState = {
  exerciseIndex: null,
  setNumber: null,
  remainingSeconds: 0,
  totalRestSeconds: 0,
  isComplete: false,
};

const renderExercise = (
  overrides: Partial<React.ComponentProps<typeof ExerciseWithSets>> = {}
) => {
  const onToggleSet = vi.fn();
  const onStartTimer = vi.fn();
  const onSkipTimer = vi.fn();
  const onCancelTimerForSet = vi.fn();

  render(
    <ExerciseWithSets
      exercise={{ name: "Bankdrücken", sets: 3, reps: 10, weight: "40 kg", rest: "90s" }}
      exerciseIndex={0}
      isSetCompleted={() => false}
      getCompletedSetsCount={() => 0}
      onToggleSet={onToggleSet}
      isToggling={false}
      defaultExpanded={false}
      timerState={idleTimerState}
      onStartTimer={onStartTimer}
      onSkipTimer={onSkipTimer}
      onCancelTimerForSet={onCancelTimerForSet}
      {...overrides}
    />
  );

  return { onToggleSet, onStartTimer, onSkipTimer, onCancelTimerForSet };
};

// The header's accessible name is built from its contents, so the exercise
// name is enough to tell it apart from the set rows.
const header = () => screen.getByRole("button", { name: /Bankdrücken/ });
const setRows = () => screen.queryAllByRole("checkbox");

describe("ExerciseWithSets header semantics", () => {
  it("renders the collapse trigger as a native button", () => {
    renderExercise();
    const trigger = header();

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
  });

  it("exposes the collapsed state through aria-expanded", () => {
    renderExercise();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(setRows()).toHaveLength(0);
  });

  it("exposes the expanded state through aria-expanded", () => {
    renderExercise({ defaultExpanded: true });

    expect(header()).toHaveAttribute("aria-expanded", "true");
  });

  it("holds no nested interactive controls", () => {
    renderExercise({ defaultExpanded: true });
    const trigger = header();

    expect(within(trigger).queryAllByRole("button")).toHaveLength(0);
    expect(within(trigger).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(trigger).queryAllByRole("link")).toHaveLength(0);
  });

  it("takes keyboard focus and keeps a visible focus ring", async () => {
    const user = userEvent.setup();
    renderExercise();

    await user.tab();

    expect(header()).toHaveFocus();
    expect(header().className).toContain("focus-visible:ring-2");
  });
});

describe("ExerciseWithSets activation", () => {
  it("expands on pointer activation", async () => {
    const user = userEvent.setup();
    renderExercise();

    await user.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(setRows()).toHaveLength(3);
  });

  it("collapses on pointer activation when already open", async () => {
    const user = userEvent.setup();
    renderExercise({ defaultExpanded: true });

    await user.click(header());

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(setRows()).toHaveLength(0);
  });

  it("expands on Enter", async () => {
    const user = userEvent.setup();
    renderExercise();

    await user.tab();
    await user.keyboard("{Enter}");

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(setRows()).toHaveLength(3);
  });

  it("expands on Space", async () => {
    const user = userEvent.setup();
    renderExercise();

    await user.tab();
    await user.keyboard("[Space]");

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(setRows()).toHaveLength(3);
  });

  it("makes the collapsed sets reachable by keyboard once opened", async () => {
    const user = userEvent.setup();
    renderExercise();

    await user.tab();
    await user.keyboard("{Enter}");

    const firstSet = screen.getByRole("checkbox", { name: /Satz 1/ });
    await user.tab();

    expect(firstSet).toHaveFocus();
  });

  it("survives repeated open and close from the keyboard", async () => {
    const user = userEvent.setup();
    renderExercise();

    await user.tab();

    for (const key of ["{Enter}", "[Space]", "{Enter}"] as const) {
      await user.keyboard(key);
      expect(header()).toHaveAttribute("aria-expanded", "true");
      expect(setRows()).toHaveLength(3);

      await user.keyboard(key);
      expect(header()).toHaveAttribute("aria-expanded", "false");
      expect(setRows()).toHaveLength(0);
    }
  });
});

describe("ExerciseWithSets set controls", () => {
  it("still toggles a set and starts its rest timer after a keyboard expand", async () => {
    const user = userEvent.setup();
    const { onToggleSet, onStartTimer } = renderExercise();

    await user.tab();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("checkbox", { name: /Satz 1/ }));

    expect(onToggleSet).toHaveBeenCalledWith({
      exerciseIndex: 0,
      setNumber: 1,
      completed: true,
    });
    expect(onStartTimer).toHaveBeenCalledWith(0, 90, 1);
  });

  it("keeps the set rows keyboard-operable", async () => {
    const user = userEvent.setup();
    const { onToggleSet } = renderExercise({ defaultExpanded: true });

    screen.getByRole("checkbox", { name: /Satz 2/ }).focus();
    await user.keyboard("{Enter}");

    expect(onToggleSet).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseIndex: 0, setNumber: 2, completed: true })
    );
  });

  it("records completion only, never the prescription as performed reps or weight", async () => {
    const user = userEvent.setup();
    const { onToggleSet, onStartTimer } = renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg", rest: "90s" },
    });

    await user.click(screen.getByRole("checkbox", { name: /Satz 1/ }));

    expect(onToggleSet).toHaveBeenCalledTimes(1);
    const [params] = onToggleSet.mock.calls[0];
    expect(params).toEqual({ exerciseIndex: 0, setNumber: 1, completed: true });
    expect(params).not.toHaveProperty("repsCompleted");
    expect(params).not.toHaveProperty("weightUsed");
    expect(onStartTimer).toHaveBeenCalledWith(0, 90, 1);
  });

  it("shows the range prescription on every set row", () => {
    renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 2, reps: "8–12", weight: "60 kg", rest: "90s" },
    });

    expect(screen.getAllByText("8–12 × 60 kg")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /Satz 1: Vorgabe 8–12 Wiederholungen mit 60 kg/ })).toBeInTheDocument();
  });

  it("does not turn a time prescription into a rep count", () => {
    renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 1, reps: "30 Sekunden", rest: "60s" },
    });

    expect(screen.getByText("30 Sekunden")).toBeInTheDocument();
    expect(screen.queryByText(/30 Wdh/)).not.toBeInTheDocument();
  });

  it("un-completes a range set with the same completion-only shape", async () => {
    const user = userEvent.setup();
    const { onToggleSet, onCancelTimerForSet } = renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg", rest: "90s" },
      isSetCompleted: (_exerciseIndex, setNumber) => setNumber === 2,
      getCompletedSetsCount: () => 1,
    });

    await user.click(screen.getByRole("checkbox", { name: /Satz 2/ }));

    expect(onToggleSet).toHaveBeenCalledWith({ exerciseIndex: 0, setNumber: 2, completed: false });
    expect(onCancelTimerForSet).toHaveBeenCalledWith(0, 2);
  });

  it("cancels only the owning set's timer when a set is un-completed", async () => {
    const user = userEvent.setup();
    const { onCancelTimerForSet, onStartTimer } = renderExercise({
      defaultExpanded: true,
      isSetCompleted: (_exerciseIndex, setNumber) => setNumber === 1,
      getCompletedSetsCount: () => 1,
    });

    await user.click(screen.getByRole("checkbox", { name: /Satz 1/ }));

    expect(onCancelTimerForSet).toHaveBeenCalledWith(0, 1);
    expect(onStartTimer).not.toHaveBeenCalled();
  });
});
