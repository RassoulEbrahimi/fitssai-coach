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
  const reps = () => screen.getByRole("textbox", { name: "Wiederholungen für Satz 2" });
  const weight = () => screen.getByRole("textbox", { name: "Gewicht für Satz 2 in kg" });
  const row = () => screen.getByRole("group", { name: "2. Satz" });
  return { drafts, commit, changeDraft, onToggle, reps, weight, row };
};

/** What a sighted user reads: the row's text without screen-reader-only parts. */
const visibleText = (element: HTMLElement) => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return clone.textContent ?? "";
};

describe("ExerciseSetRow compact layout", () => {
  it("reads as one line: set number, reps × kg, rest, completion", () => {
    const { reps, weight, row } = renderWithInputs({ rest: "90s" });

    expect(row()).toHaveAccessibleName("2. Satz");
    expect(within(row()).getByText("2. Satz")).toHaveAttribute("id", row().getAttribute("aria-labelledby"));
    expect(visibleText(row())).toBe("2. Satz×kg• 90 s Pause");
    expect(screen.getByText("90 s Pause")).toBeInTheDocument();
    // × and kg sit between and after the fields; the fields' names carry the meaning.
    const times = screen.getByText("×");
    expect(times).toHaveAttribute("aria-hidden", "true");
    expect(times.compareDocumentPosition(reps()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(times.compareDocumentPosition(weight()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(weight().nextElementSibling).toHaveTextContent(/^kg$/);
    expect(weight().nextElementSibling).toHaveAttribute("aria-hidden", "true");
  });

  it("shows no visible Wdh. field label and no separate Vorgabe line", () => {
    const { row } = renderWithInputs();

    expect(screen.queryByText("Wdh.")).toBeNull();
    expect(screen.queryByText(/Vorgabe/)).toBeNull();
    expect(visibleText(row())).not.toMatch(/Wdh|Vorgabe/);
  });

  it("keeps strong accessible names for both fields", () => {
    const { reps, weight } = renderWithInputs();

    expect(reps()).toHaveAttribute("inputmode", "numeric");
    expect(weight()).toHaveAttribute("inputmode", "decimal");
    expect(reps()).toHaveAccessibleName("Wiederholungen für Satz 2");
    expect(weight()).toHaveAccessibleName("Gewicht für Satz 2 in kg");
    // A full 44px target each, in a row that is still 44px tall.
    expect(reps().className).toContain("h-11");
    expect(weight().className).toContain("h-11");
    expect(reps().closest(".workout-set-entry")?.className).toContain("h-11");
  });

  /*
    TRAINING-UI-06: the numbers are the row. They are written straight on the
    surface - larger than the words around them, with no box, outline or fill
    per field - and only an empty field keeps a hairline to type on.
  */
  it("writes the values flat on the row, with no box around a field", () => {
    const { reps, weight, row } = renderWithInputs({ rest: "90s" });

    for (const field of [reps(), weight()]) {
      const tokens = field.className.split(/\s+/);
      expect(tokens).toContain("bg-transparent");
      expect(tokens).toContain("border-x-0");
      expect(tokens).toContain("border-t-0");
      expect(tokens).toContain("rounded-none");
      expect(tokens).not.toContain("bg-background");
      expect(tokens).not.toContain("border-input");
      // No painted ring or shadow; `ring-offset-background` only names a colour.
      expect(tokens.some((token) => /^(shadow|ring)-\d/.test(token))).toBe(false);
      expect(tokens.some((token) => token.startsWith("shadow"))).toBe(false);
    }
    // The hairline is the empty state only, and it is a single rule, not a frame.
    expect(reps().className).toContain("border-b");
    expect(reps().className).toContain("data-[empty]:border-dashed");
    expect(within(row()).getByText("×").className).toContain("text-lg");
    expect(within(row()).getByText("kg").className).toContain("text-base");
  });

  it.each([
    ["reps", () => screen.getByRole("textbox", { name: "Wiederholungen für Satz 2" })],
    ["weight", () => screen.getByRole("textbox", { name: "Gewicht für Satz 2 in kg" })],
  ])("draws the %s value larger than its hint and the words beside it", (_name, field) => {
    const { row } = renderWithInputs({ rest: "90s" });

    expect(field().className).toContain("text-lg");
    expect(field().className).toContain("md:text-lg");
    expect(field().className).toContain("placeholder:text-base");
    // The prescribed rest grew with them and stays the quieter fact.
    expect(within(row()).getByText("90 s Pause").className).toContain("text-sm");
    expect(within(row()).getByText("90 s Pause").className).not.toContain("text-xs");
  });

  it("omits the rest when none is prescribed", () => {
    renderWithInputs({ rest: undefined });
    expect(screen.queryByText(/Pause/)).toBeNull();

    renderWithInputs({ rest: "0s" });
    expect(screen.queryByText(/Pause/)).toBeNull();
  });

  it("adds no line below the row without last time or an error", () => {
    const { row } = renderWithInputs();

    expect(row().querySelectorAll(".workout-set-detail")).toHaveLength(0);
    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks a completed row with state, not only a tint", () => {
    const { row } = renderWithInputs({ isCompleted: true });

    expect(row()).toHaveAttribute("data-completed");
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox").querySelector("svg")).not.toBeNull();
  });

  it("shows the prescription as text when there are no inputs", () => {
    render(<ExerciseSetRow setNumber={1} targetReps={12} targetWeight="50 kg" rest="60s"
      isCompleted={false} isToggling={false} onToggle={vi.fn()} />);

    expect(screen.getByText("12 × 50 kg")).toBeInTheDocument();
    expect(screen.getByText("60 s Pause")).toBeInTheDocument();
    expect(screen.queryByText(/Vorgabe/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("ExerciseSetRow prescription placeholders", () => {
  it("shows the prescribed reps and weight as placeholders, never as values", () => {
    const { reps, weight } = renderWithInputs();

    expect(reps()).toHaveAttribute("placeholder", "12");
    expect(weight()).toHaveAttribute("placeholder", "50");
    expect(reps()).toHaveValue("");
    expect(weight()).toHaveValue("");
    expect(reps()).toHaveAttribute("data-empty");
    expect(weight()).toHaveAttribute("data-empty");
  });

  it("keeps a rep range as the reps placeholder", () => {
    const { reps, weight } = renderWithInputs({ targetReps: "8–12", targetWeight: "52,5 kg" });

    expect(reps()).toHaveAttribute("placeholder", "8–12");
    expect(weight()).toHaveAttribute("placeholder", "52,5");
    expect(screen.queryByText(/Vorgabe/)).toBeNull();
  });

  it.each([
    ["no weight", undefined],
    ["a load in words", "Körpergewicht"],
    ["0 kg", "0 kg"],
    ["a load range", "100–120 kg"],
  ])("gives no weight placeholder for %s", (_label, targetWeight) => {
    const { weight } = renderWithInputs({ targetWeight });

    expect(weight()).not.toHaveAttribute("placeholder");
    expect(weight()).toHaveValue("");
    expect(document.querySelector("input[placeholder='0']")).toBeNull();
  });

  it("writes out a prescription the placeholders cannot carry", () => {
    const { reps, row } = renderWithInputs({ targetReps: "30 Sekunden", targetWeight: undefined });

    expect(reps()).not.toHaveAttribute("placeholder");
    expect(visibleText(row())).toContain("Vorgabe: 30 Sekunden");
    expect(screen.queryByText(/30 Wdh/)).toBeNull();
  });

  it("writes out a load in words next to the reps placeholder", () => {
    const { reps, row } = renderWithInputs({ targetReps: 6, targetWeight: "Körpergewicht" });

    expect(reps()).toHaveAttribute("placeholder", "6");
    expect(visibleText(row())).toContain("Vorgabe: 6 × Körpergewicht");
  });

  it("adds no Vorgabe line for a bodyweight exercise with a plain count", () => {
    const { reps, weight } = renderWithInputs({ targetReps: 15, targetWeight: undefined });

    expect(reps()).toHaveAttribute("placeholder", "15");
    expect(weight()).not.toHaveAttribute("placeholder");
    expect(screen.queryByText(/Vorgabe/)).toBeNull();
  });

  it("never turns the placeholder into a draft or a commit payload", async () => {
    const user = userEvent.setup();
    const { reps, weight, drafts, changeDraft, commit, onToggle } = renderWithInputs();

    await user.click(reps());
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();

    // Blur and Enter only ask the owner to commit whatever the draft holds - here nothing.
    expect(commit).toHaveBeenCalled();
    expect(changeDraft).not.toHaveBeenCalled();
    expect(drafts.keys()).toEqual([]);
    expect(reps()).toHaveValue("");
    expect(weight()).toHaveValue("");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("completes without copying the placeholder", async () => {
    const user = userEvent.setup();
    const { drafts, changeDraft, onToggle, reps } = renderWithInputs();

    await user.click(screen.getByRole("checkbox"));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(changeDraft).not.toHaveBeenCalled();
    expect(drafts.keys()).toEqual([]);
    expect(reps()).toHaveValue("");
  });

  it("shows recorded values instead of the placeholder look", () => {
    const { reps, weight } = renderWithInputs({ actual: { reps: 10, weightKg: 52.5 } });

    expect(reps()).toHaveValue("10");
    expect(weight()).toHaveValue("52,5");
    expect(reps()).not.toHaveAttribute("data-empty");
    expect(weight()).not.toHaveAttribute("data-empty");
    expect(reps().className).toContain("font-semibold");
    expect(reps().className).toContain("placeholder:font-normal");
  });

  it("shows a draft over the recorded value", () => {
    const { drafts, reps, weight } = renderWithInputs({ actual: { reps: 10, weightKg: 52.5 } });

    act(() => drafts.set("1:2", { reps: "7", weight: "" }));

    expect(reps()).toHaveValue("7");
    // A cleared draft shows empty - with the hint - rather than the recorded value.
    expect(weight()).toHaveValue("");
    expect(weight()).toHaveAttribute("data-empty");
  });

  it("accepts a decimal comma as typed", async () => {
    const user = userEvent.setup();
    const { weight, changeDraft } = renderWithInputs();

    await user.type(weight(), "52,5");

    expect(weight()).toHaveValue("52,5");
    expect(changeDraft).toHaveBeenLastCalledWith(1, 2, "weight", "52,5");
  });
});

describe("ExerciseSetRow actual performance entry", () => {

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

    // Shown compactly, spoken with units.
    expect(visibleText(reference())).toBe("Letztes Mal: 10 × 52,5 kg");
    expect(within(reference()).getByText("10 × 52,5 kg")).toHaveAttribute("aria-hidden", "true");
    expect(within(reference()).getByText("10 Wdh. · 52,5 kg")).toHaveClass("sr-only");
    expect(copy()).toHaveAccessibleName("Übernehmen für Satz 2: Letztes Mal 10 Wdh. · 52,5 kg");
    expect(copy()).toHaveTextContent(/^Übernehmen$/);
    // Today's fields keep today's prescription as their hint, not last time's values.
    expect(screen.getByRole("textbox", { name: "Wiederholungen für Satz 2" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Wiederholungen für Satz 2" })).toHaveAttribute("placeholder", "8–12");
    expect(screen.getByRole("textbox", { name: "Gewicht für Satz 2 in kg" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Gewicht für Satz 2 in kg" })).toHaveAttribute("placeholder", "50");
  });

  it("keeps the reference to one secondary line below today's row", () => {
    renderWithPrevious({ reps: 10, weightKg: 52.5 });
    const group = screen.getByRole("group", { name: "2. Satz" });
    const details = group.querySelectorAll(".workout-set-detail");

    expect(details).toHaveLength(1);
    expect(details[0]).toHaveTextContent("Letztes Mal:");
    expect(within(details[0] as HTMLElement).getByRole("button", { name: /^Übernehmen/ })).toBeInTheDocument();
    expect(within(details[0] as HTMLElement).queryByRole("textbox")).toBeNull();
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
    expect(screen.getByRole("textbox", { name: "Wiederholungen für Satz 2" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Gewicht für Satz 2 in kg" })).toHaveFocus();
    await user.tab();
    expect(copy()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(copyPrevious).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("keeps a real 44px touch target without enlarging the row", () => {
    const { copy } = renderWithPrevious({ reps: 10, weightKg: 52.5 });

    // jsdom does not lay out. The button's own box is 44px with -8px margins,
    // so it occupies a 28px line, and the line's 8px top margin keeps the box
    // clear of the inputs; Chromium does not hit-test a pseudo-element outside
    // a button, so the hit area has to be the button itself.
    expect(copy().className).toContain("h-11");
    expect(copy().className).toContain("-my-2");
    expect(copy().parentElement?.className).toContain("mt-2");
    const face = copy().querySelector("[data-copy-face]");
    expect(face?.className).toContain("h-7");
    // TRAINING-UI-06: no focus ring is painted in the running workout.
    expect(face?.className).not.toMatch(/focus-visible:ring/);
    expect(copy()).toHaveTextContent("Übernehmen");
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
