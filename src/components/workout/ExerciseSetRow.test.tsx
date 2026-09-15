import { describe, it, expect, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExerciseSetRow from "./ExerciseSetRow";
import { SetPerformanceDraftStore, type SetPerformanceField } from "@/lib/setPerformanceDrafts";

const renderWithInputs = (overrides: Partial<React.ComponentProps<typeof ExerciseSetRow>> = {}) => {
  const drafts = new SetPerformanceDraftStore();
  const commit = vi.fn(() => "unchanged" as const);
  const changeDraft = vi.fn((exerciseIndex: number, setNumber: number, field: SetPerformanceField, text: string) => {
    const key = `${exerciseIndex}:${setNumber}`;
    const current = drafts.get(key) ?? {};
    drafts.set(key, field === "reps"
      ? { ...current, reps: text, repsError: undefined }
      : { ...current, weight: text, weightError: undefined });
  });
  const onToggle = vi.fn();
  render(
    <ExerciseSetRow
      exerciseIndex={1}
      setNumber={2}
      targetReps={12}
      targetWeight="50 kg"
      isCompleted={false}
      isToggling={false}
      onToggle={onToggle}
      actual={{ reps: null, weightKg: null }}
      performance={{ drafts, changeDraft, commit }}
      {...overrides}
    />
  );
  const reps = () => screen.getByRole("textbox", { name: "Satz 2: ausgeführte Wiederholungen" });
  const weight = () => screen.getByRole("textbox", { name: "Satz 2: ausgeführtes Gewicht in kg" });
  return { drafts, commit, changeDraft, onToggle, reps, weight };
};

describe("ExerciseSetRow actual performance entry", () => {
  it("labels both inputs visibly and accessibly, beside the prescription", () => {
    const { reps, weight } = renderWithInputs();

    expect(reps()).toHaveAttribute("inputmode", "numeric");
    expect(weight()).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("Wdh.")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
    expect(screen.getByText("Vorgabe:")).toBeInTheDocument();
    expect(screen.getByText("12 × 50 kg")).toBeInTheDocument();
    // Prescription is not a recorded value.
    expect(reps()).toHaveValue("");
    expect(weight()).toHaveValue("");
    expect(reps().className).toContain("h-11");
    expect(weight().className).toContain("h-11");
  });

  it("keeps the inputs outside the completion control", () => {
    renderWithInputs();
    const checkbox = screen.getByRole("checkbox");

    expect(within(checkbox).queryByRole("textbox")).toBeNull();
    expect(within(screen.getByRole("group", { name: "2. Satz" })).getAllByRole("textbox")).toHaveLength(2);
  });

  it("types into reps without completing the set", async () => {
    const user = userEvent.setup();
    const { reps, onToggle, changeDraft } = renderWithInputs();

    await user.click(reps());
    await user.type(reps(), "12");

    expect(reps()).toHaveValue("12");
    expect(changeDraft).toHaveBeenLastCalledWith(1, 2, "reps", "12");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("commits on blur and on Enter, and neither completes the set", async () => {
    const user = userEvent.setup();
    const { reps, weight, commit, onToggle } = renderWithInputs();

    await user.click(reps());
    await user.type(reps(), "10");
    await user.tab();
    expect(weight()).toHaveFocus();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith(1, 2);

    await user.type(weight(), "52,5{Enter}");
    expect(commit).toHaveBeenCalledTimes(2);
    expect(weight()).toHaveFocus();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("moves reps, weight, completion in keyboard order and toggles only from the completion control", async () => {
    const user = userEvent.setup();
    const { reps, weight, onToggle } = renderWithInputs();

    await user.tab();
    expect(reps()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onToggle).not.toHaveBeenCalled();
    await user.tab();
    expect(weight()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("shows recorded values in German notation", () => {
    const { reps, weight } = renderWithInputs({ actual: { reps: 10, weightKg: 52.5 } });

    expect(reps()).toHaveValue("10");
    expect(weight()).toHaveValue("52,5");
  });

  it("ties a refused value's reason to its own field", () => {
    const { drafts, weight, reps } = renderWithInputs();

    act(() => drafts.set("1:2", { weight: "abc", weightError: "Gewicht ungültig." }));

    expect(weight()).toHaveValue("abc");
    expect(weight()).toHaveAttribute("aria-invalid", "true");
    expect(weight()).toHaveAccessibleDescription("Gewicht ungültig.");
    expect(screen.getByRole("alert")).toHaveTextContent("Gewicht ungültig.");
    expect(reps()).not.toHaveAttribute("aria-invalid");
  });

  it("conveys completion by shape as well as colour", () => {
    renderWithInputs({ isCompleted: true });
    expect(screen.getByRole("checkbox").querySelector("svg")).not.toBeNull();
  });

  it("leaves the inputs usable while a completion is being saved", async () => {
    const user = userEvent.setup();
    const { reps } = renderWithInputs({ isToggling: true });

    await user.type(reps(), "7");

    expect(reps()).toHaveValue("7");
    expect(screen.getByRole("checkbox").className).toContain("pointer-events-none");
  });
});

const renderWithPrevious = (
  previous: React.ComponentProps<typeof ExerciseSetRow>["previous"],
  overrides: Partial<React.ComponentProps<typeof ExerciseSetRow>> = {},
  { withCopy = true }: { withCopy?: boolean } = {}
) => {
  const drafts = new SetPerformanceDraftStore();
  const commit = vi.fn(() => "unchanged" as const);
  const copyPrevious = vi.fn();
  const onToggle = vi.fn();
  render(
    <ExerciseSetRow
      exerciseIndex={1}
      setNumber={2}
      targetReps="8–12"
      targetWeight="50 kg"
      isCompleted={false}
      isToggling={false}
      onToggle={onToggle}
      actual={{ reps: null, weightKg: null }}
      performance={{ drafts, changeDraft: vi.fn(), commit, ...(withCopy ? { copyPrevious } : {}) }}
      previous={previous}
      {...overrides}
    />
  );
  const reference = () => screen.getByText("Letztes Mal:").parentElement!;
  const copy = () => screen.getByRole("button", { name: /^Übernehmen für Satz 2:/ });
  return { drafts, commit, copyPrevious, onToggle, reference, copy };
};

describe("ExerciseSetRow previous performance reference", () => {
  it("shows reps and weight from last time as a labelled reference, not as today's values", () => {
    const { reference, copy } = renderWithPrevious({ reps: 10, weightKg: 52.5 });

    expect(reference()).toHaveTextContent(/^Letztes Mal: 10 Wdh\. · 52,5 kg$/);
    expect(copy()).toHaveAccessibleName("Übernehmen für Satz 2: Letztes Mal 10 Wdh. · 52,5 kg");
    expect(copy()).toHaveTextContent(/^Übernehmen$/);
    expect(screen.getByText("8–12 × 50 kg")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Satz 2: ausgeführte Wiederholungen" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Satz 2: ausgeführtes Gewicht in kg" })).toHaveValue("");
  });

  it("names only the reps when only reps were recorded", () => {
    const { reference, copy } = renderWithPrevious({ reps: 10, weightKg: null });

    expect(reference()).toHaveTextContent(/^Letztes Mal: 10 Wdh\.$/);
    expect(copy()).toHaveAccessibleName("Übernehmen für Satz 2: Letztes Mal 10 Wdh.");
  });

  it("names only the weight when only weight was recorded", () => {
    const { reference } = renderWithPrevious({ reps: null, weightKg: 52.5 });

    expect(reference()).toHaveTextContent(/^Letztes Mal: 52,5 kg$/);
    expect(reference().textContent).not.toMatch(/Wdh|—|\b0\b/);
  });

  it.each([
    ["no previous performance", undefined],
    ["an explicit none", null],
    ["a previous set without values", { reps: null, weightKg: null }],
  ])("adds nothing to the row for %s", (_label, previous) => {
    renderWithPrevious(previous);

    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Übernehmen/ })).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("offers no reference without today's inputs", () => {
    render(
      <ExerciseSetRow setNumber={2} targetReps={10} isCompleted={false} isToggling={false} onToggle={vi.fn()}
        previous={{ reps: 10, weightKg: 52.5 }} />
    );

    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
  });

  it("shows the reference without a copy control when copying is not offered", () => {
    renderWithPrevious({ reps: 10, weightKg: 52.5 }, {}, { withCopy: false });

    expect(screen.getByText("Letztes Mal:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Übernehmen/ })).toBeNull();
  });

  it("copies on click without completing, saving or moving focus", async () => {
    const user = userEvent.setup();
    const { copy, copyPrevious, onToggle, commit } = renderWithPrevious({ reps: 10, weightKg: 52.5 });

    await user.click(copy());

    expect(copyPrevious).toHaveBeenCalledTimes(1);
    expect(copyPrevious).toHaveBeenCalledWith(1, 2);
    expect(onToggle).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(copy()).toHaveFocus();
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  it("sits between today's inputs and completion in keyboard order, and works from the keyboard", async () => {
    const user = userEvent.setup();
    const { copy, copyPrevious, onToggle } = renderWithPrevious({ reps: 10, weightKg: 52.5 });

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Satz 2: ausgeführte Wiederholungen" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Satz 2: ausgeführtes Gewicht in kg" })).toHaveFocus();
    await user.tab();
    expect(copy()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(copyPrevious).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("keeps a 44px touch target without enlarging the row", () => {
    const { copy } = renderWithPrevious({ reps: 10, weightKg: 52.5 });

    // jsdom does not lay out: a 32px control whose hit area extends 6px each way.
    expect(copy().className).toContain("h-8");
    expect(copy().className).toContain("after:-inset-y-1.5");
    expect(copy().className).toContain("focus-visible:ring-2");
  });

  it("marks the reference with words as well as an icon and colour", () => {
    const { reference } = renderWithPrevious({ reps: 10, weightKg: 52.5 });

    expect(reference().closest("p")?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(reference()).getByText("Letztes Mal:")).toBeInTheDocument();
  });
});

const renderRow = (overrides: Partial<React.ComponentProps<typeof ExerciseSetRow>> = {}) => {
  const onToggle = vi.fn();
  render(
    <ExerciseSetRow
      setNumber={2}
      targetReps={10}
      isCompleted={false}
      isToggling={false}
      onToggle={onToggle}
      {...overrides}
    />
  );
  return { onToggle };
};

describe("ExerciseSetRow accessibility", () => {
  it("exposes a checkbox control", () => {
    renderRow();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("names itself with the set number, reps and current state", () => {
    renderRow();
    const control = screen.getByRole("checkbox");
    const name = control.getAttribute("aria-label") ?? "";

    expect(name).toContain("Satz 2");
    expect(name).toContain("10");
    expect(name).toContain("offen");
  });

  it("reflects the completed state in name and aria-checked", () => {
    renderRow({ isCompleted: true });
    const control = screen.getByRole("checkbox");

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control.getAttribute("aria-label")).toContain("abgeschlossen");
  });

  it("includes the target weight in the name when present", () => {
    renderRow({ targetWeight: "20 kg" });
    expect(screen.getByRole("checkbox").getAttribute("aria-label")).toContain("20 kg");
  });

  it("is reachable by keyboard", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("toggles with Enter", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderRow();

    screen.getByRole("checkbox").focus();
    await user.keyboard("{Enter}");

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles with Space", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderRow();

    screen.getByRole("checkbox").focus();
    await user.keyboard(" ");

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("still toggles on click", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderRow();

    await user.click(screen.getByRole("checkbox"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("meets the 44px target floor", () => {
    renderRow();
    // jsdom does not lay out, so assert the constraint that produces the size.
    expect(screen.getByRole("checkbox").className).toContain("min-h-[44px]");
  });
});

describe("ExerciseSetRow prescription display", () => {
  const label = () => screen.getByRole("checkbox").getAttribute("aria-label") ?? "";

  it("shows a plain count with its unit", () => {
    renderRow({ targetReps: 10 });
    expect(screen.getByText("10 Wdh")).toBeInTheDocument();
    expect(label()).toContain("10 Wiederholungen");
  });

  it("keeps a rep range intact instead of reducing it to its lower bound", () => {
    renderRow({ targetReps: "8–12" });

    expect(screen.getByText("8–12 Wdh")).toBeInTheDocument();
    expect(screen.queryByText("8 Wdh")).not.toBeInTheDocument();
    expect(label()).toContain("8–12 Wiederholungen");
    expect(label()).not.toMatch(/Vorgabe 8 /);
  });

  it("keeps a hyphenated range as written", () => {
    renderRow({ targetReps: "8-12", targetWeight: "60 kg" });

    expect(screen.getByText("8-12 × 60 kg")).toBeInTheDocument();
    expect(label()).toContain("8-12 Wiederholungen mit 60 kg");
  });

  it("does not present a time prescription as repetitions", () => {
    renderRow({ targetReps: "30 Sekunden" });

    expect(screen.getByText("30 Sekunden")).toBeInTheDocument();
    expect(screen.queryByText(/Wdh/)).not.toBeInTheDocument();
    expect(label()).toContain("30 Sekunden");
    expect(label()).not.toContain("Wiederholungen");
  });

  it("keeps a textual prescription such as AMRAP as written", () => {
    renderRow({ targetReps: "AMRAP", targetWeight: "20 kg" });

    expect(screen.getByText("AMRAP × 20 kg")).toBeInTheDocument();
    expect(label()).toContain("AMRAP mit 20 kg");
    expect(label()).not.toContain("Wiederholungen");
  });
});
