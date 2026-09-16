import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExerciseWithSets from "./ExerciseWithSets";
import { SetPerformanceDraftStore } from "@/lib/setPerformanceDrafts";
import type { PreviousExercisePerformance } from "@/lib/previousPerformance";

const idleTimerState = {
  status: 'idle' as const,
  deadlineMs: null,
  pausedRemainingSeconds: null,
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
      isRestSheetOpen={false}
      onOpenRest={vi.fn()}
      {...overrides}
    />
  );

  return { onToggleSet };
};

// The collapse trigger is named "<exercise> <done>/<total> Sätze", so the
// exercise name is enough to tell it apart from the set rows and Info.
const header = () => screen.getByRole("button", { name: /^Bankdrücken/ });
const setRows = () => screen.queryAllByRole("checkbox");
const headerBlock = () => document.querySelector<HTMLElement>(".workout-exercise-header")!;
const metaLine = () => headerBlock().querySelector<HTMLElement>(".workout-exercise-meta")!;

// Info sits above collapse in the action column, and comes first in tab order too.
const tabToCollapse = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.tab();
  expect(screen.getByRole("button", { name: "Informationen zu Bankdrücken" })).toHaveFocus();
  await user.tab();
  expect(header()).toHaveFocus();
};

describe("ExerciseWithSets header semantics", () => {
  it("renders a thumbnail surface for every exercise: a local asset when reviewed, a fallback otherwise", () => {
    renderExercise();
    const known = document.querySelector("[data-exercise-thumbnail]");
    expect(known?.querySelector("img")?.getAttribute("src")).toContain("bench-press.svg");
    expect(known?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("does not give a qualified variant the flat bench asset", () => {
    renderExercise({ exercise: { name: "Bankdrücken schräg Multipresse", sets: 3, reps: 12 } });
    const source = document.querySelector("[data-exercise-thumbnail] img")?.getAttribute("src");
    expect(source).toContain("incline-smith-bench-press.svg");
    expect(source).not.toContain("/bench-press.svg");
    expect(screen.getByRole("heading", { name: "Bankdrücken schräg Multipresse" })).toBeInTheDocument();
  });

  it("falls back for a name the registry does not know", () => {
    renderExercise({ exercise: { name: "Brustpresse Maschine", sets: 3, reps: 12 } });
    const surface = document.querySelector("[data-exercise-thumbnail]");
    expect(surface?.querySelector("img")).toBeNull();
    expect(surface).toHaveTextContent("BM");
  });

  it.each([
    'Kreuzheben konventionell',
    'Schrägbankdrücken mit Kurzhanteln',
    'Bankdrücken schräg Multipresse',
    'Trizepsstrecken Kabelzug Kordel',
    'Beinpresse 45° Plate Loaded',
  ])('keeps the full name %s beside a decorative thumbnail and independent actions', async (name) => {
    const user = userEvent.setup();
    renderExercise({ exercise: { name, sets: 3, reps: 12 } });
    const title = screen.getByRole('heading', { level: 3, name });
    expect(title).toHaveTextContent(name);
    expect(title.className).not.toMatch(/\b(truncate|whitespace-nowrap|line-clamp-1|text-ellipsis)\b/);
    expect(title.closest('.workout-exercise-header')?.querySelector('[data-exercise-thumbnail]')).not.toBeNull();
    const collapse = screen.getByRole('button', { name: `${name} 0/3 Sätze` });
    const info = screen.getByRole('button', { name: `Informationen zu ${name}` });

    // Info opens guidance and leaves the card collapsed.
    await user.click(info);
    expect(screen.getByRole('dialog', { name })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(collapse).toHaveAttribute('aria-expanded', 'false');
    expect(setRows()).toHaveLength(0);

    // Collapse opens the sets and no dialog.
    await user.click(collapse);
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(setRows()).toHaveLength(3);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Info while expanded keeps the card expanded.
    await user.click(info);
    expect(screen.getByRole('dialog', { name })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks completed exercises with text and a check, as well as colour', () => {
    renderExercise({ getCompletedSetsCount: () => 3, isSetCompleted: () => true });
    expect(screen.getByText('abgeschlossen')).toHaveClass('sr-only');
    expect(metaLine()).toHaveTextContent('3/3 Sätze');
    expect(metaLine().querySelector('svg')).not.toBeNull();
    expect(headerBlock().closest('.workout-exercise-unit')).toHaveAttribute('data-complete');
    expect(header()).toHaveAccessibleName('Bankdrücken 3/3 Sätze');
  });

  it('does not mark a partly done exercise as completed', () => {
    renderExercise({ getCompletedSetsCount: () => 2, isSetCompleted: (_exerciseIndex, setNumber) => setNumber < 3 });
    expect(metaLine()).toHaveTextContent('2/3 Sätze');
    expect(metaLine().querySelector('svg')).toBeNull();
    expect(screen.queryByText('abgeschlossen')).toBeNull();
    expect(headerBlock().closest('.workout-exercise-unit')).not.toHaveAttribute('data-complete');
  });

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

    await tabToCollapse(user);

    expect(header().className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "Informationen zu Bankdrücken" }).className).toContain("focus-visible:ring-2");
  });
});

describe("ExerciseWithSets header layout", () => {
  it("puts the name, sets, rest and progress in one block beside the thumbnail", () => {
    renderExercise({
      exercise: { name: "Bankdrücken", sets: 4, reps: 10, weight: "40 kg", rest: "90s" },
      getCompletedSetsCount: () => 2,
      isSetCompleted: (_exerciseIndex, setNumber) => setNumber < 3,
    });
    const block = headerBlock();
    const identity = block.querySelector<HTMLElement>(".workout-exercise-identity")!;

    expect(block.querySelector("[data-exercise-thumbnail]")).not.toBeNull();
    expect(identity).toContainElement(within(block).getByRole("heading", { level: 3, name: "Bankdrücken" }));
    expect(identity).toContainElement(metaLine());
    // Two facts on one line: the dot between them is CSS, a comma is spoken.
    const facts = metaLine().querySelectorAll(".workout-exercise-facts > span");
    expect(facts).toHaveLength(2);
    expect(facts[0]).toHaveTextContent(/^2\/4 Sätze$/);
    expect(facts[1]).toHaveTextContent(/^, 90 s Pause$/);
    expect(within(metaLine()).getByText(",")).toHaveClass("sr-only");
    expect(within(metaLine()).getByText("90 s Pause")).toBeInTheDocument();
    expect(metaLine()).toHaveTextContent("2/4 Sätze, 90 s Pause");
  });

  it("leaves the rest out of the meta line when none is prescribed", () => {
    renderExercise({ exercise: { name: "Bankdrücken", sets: 3, reps: 10 } });

    expect(metaLine().querySelectorAll(".workout-exercise-facts > span")).toHaveLength(1);
    expect(metaLine()).toHaveTextContent(/^0\/3 Sätze$/);
  });

  it.each([
    [0, 3, "translateX(-100%)"],
    [1, 3, "translateX(-67%)"],
    [2, 4, "translateX(-50%)"],
  ])("draws %i of %i sets as progress, decoratively beside the stated count", (done, sets, transform) => {
    renderExercise({
      exercise: { name: "Bankdrücken", sets, reps: 10, rest: "90s" },
      getCompletedSetsCount: () => done,
    });
    const bar = metaLine().querySelector<HTMLElement>("[role=progressbar]")!;

    expect(metaLine()).toHaveTextContent(`${done}/${sets} Sätze`);
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe(transform);
  });

  it("offers exactly Info and collapse, in that order, and no exercise completion action", () => {
    renderExercise();
    const block = headerBlock();
    const actions = block.querySelector<HTMLElement>(".workout-exercise-actions")!;

    expect(within(actions).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Informationen zu Bankdrücken",
      "Bankdrücken 0/3 Sätze",
    ]);
    expect(within(block).getAllByRole("button")).toHaveLength(2);
    expect(within(block).queryAllByRole("checkbox")).toHaveLength(0);
    for (const button of within(actions).getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.className).toMatch(/\bh-11\b/);
      expect(button.className).toMatch(/\bw-11\b/);
      expect(within(button).queryAllByRole("button")).toHaveLength(0);
    }
  });

  it("keeps the header identical when expanded, apart from the chevron state", async () => {
    const user = userEvent.setup();
    renderExercise();
    const markup = () => {
      const copy = headerBlock().cloneNode(true) as HTMLElement;
      const trigger = copy.querySelector(".workout-exercise-toggle")!;
      trigger.removeAttribute("aria-expanded");
      trigger.removeAttribute("data-state");
      return copy.outerHTML;
    };
    const collapsed = markup();

    expect(header()).toHaveAttribute("data-state", "closed");
    expect(header().querySelector("svg")).toHaveClass("workout-exercise-chevron");
    await user.click(header());

    expect(header()).toHaveAttribute("data-state", "open");
    expect(markup()).toBe(collapsed);
  });

  it("renders no set rows or hidden content while collapsed", async () => {
    const user = userEvent.setup();
    renderExercise({ exercise: { name: "Bankdrücken", sets: 4, reps: 10, rest: "90s" } });
    const content = document.getElementById(header().getAttribute("aria-controls")!)!;

    expect(setRows()).toHaveLength(0);
    expect(content).toBeEmptyDOMElement();
    expect(content).toHaveAttribute("hidden");

    await user.click(header());
    expect(setRows()).toHaveLength(4);
  });

  it("keeps the inline rest timer below the header, collapsed or not", () => {
    renderExercise({
      timerState: { ...idleTimerState, status: "running", exerciseIndex: 0, setNumber: 1, remainingSeconds: 60, totalRestSeconds: 90, deadlineMs: 60_000 },
    });
    const bar = screen.getByRole("button", { name: "Pause für Satz 1 öffnen" });

    expect(headerBlock()).not.toContainElement(bar);
    expect(headerBlock().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header()).toHaveAttribute("aria-expanded", "false");
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

    await tabToCollapse(user);
    await user.keyboard("{Enter}");

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(setRows()).toHaveLength(3);
  });

  it("expands on Space", async () => {
    const user = userEvent.setup();
    renderExercise();

    await tabToCollapse(user);
    await user.keyboard("[Space]");

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(setRows()).toHaveLength(3);
  });

  it("makes the collapsed sets reachable by keyboard once opened", async () => {
    const user = userEvent.setup();
    renderExercise();

    await tabToCollapse(user);
    await user.keyboard("{Enter}");

    const firstSet = screen.getByRole("checkbox", { name: /Satz 1/ });
    // Collapse sits directly before the sets it controls.
    await user.tab();

    expect(firstSet).toHaveFocus();
  });

  it("survives repeated open and close from the keyboard", async () => {
    const user = userEvent.setup();
    renderExercise();

    await tabToCollapse(user);

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
  it("delegates set completion after a keyboard expand", async () => {
    const user = userEvent.setup();
    const { onToggleSet } = renderExercise();

    await tabToCollapse(user);
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("checkbox", { name: /Satz 1/ }));

    expect(onToggleSet).toHaveBeenCalledWith({
      exerciseIndex: 0,
      setNumber: 1,
      completed: true,
    });
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
    const { onToggleSet } = renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg", rest: "90s" },
    });

    await user.click(screen.getByRole("checkbox", { name: /Satz 1/ }));

    expect(onToggleSet).toHaveBeenCalledTimes(1);
    const [params] = onToggleSet.mock.calls[0];
    expect(params).toEqual({ exerciseIndex: 0, setNumber: 1, completed: true });
    expect(params).not.toHaveProperty("repsCompleted");
    expect(params).not.toHaveProperty("weightUsed");
  });

  it("shows the range prescription on every set row", () => {
    renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 2, reps: "8–12", weight: "60 kg", rest: "90s" },
    });

    expect(screen.getAllByText("8–12 × 60 kg")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /Satz 1: Vorgabe 8–12 Wiederholungen mit 60 kg/ })).toBeInTheDocument();
  });

  it("shows the prescribed rest on every set row as well as in the header", () => {
    renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 3, reps: 10, weight: "40 kg", rest: "90s" },
      performance: { drafts: new SetPerformanceDraftStore(), changeDraft: vi.fn(), commit: vi.fn(() => "unchanged" as const) },
    });

    // Once in the header, once per row.
    expect(screen.getAllByText("90 s Pause")).toHaveLength(4);
    for (const setNumber of [1, 2, 3]) {
      const row = screen.getByRole("group", { name: `${setNumber}. Satz` });
      expect(within(row).getByText("90 s Pause")).toBeInTheDocument();
      expect(within(row).getByRole("textbox", { name: `Wiederholungen für Satz ${setNumber}` })).toHaveAttribute("placeholder", "10");
      expect(within(row).getByRole("textbox", { name: `Gewicht für Satz ${setNumber} in kg` })).toHaveAttribute("placeholder", "40");
    }
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
    const { onToggleSet } = renderExercise({
      defaultExpanded: true,
      exercise: { name: "Bankdrücken", sets: 3, reps: "8–12", weight: "60 kg", rest: "90s" },
      isSetCompleted: (_exerciseIndex, setNumber) => setNumber === 2,
      getCompletedSetsCount: () => 1,
    });

    await user.click(screen.getByRole("checkbox", { name: /Satz 2/ }));

    expect(onToggleSet).toHaveBeenCalledWith({ exerciseIndex: 0, setNumber: 2, completed: false });
  });

  it("delegates uncompletion with exact set coordinates", async () => {
    const user = userEvent.setup();
    const { onToggleSet } = renderExercise({
      defaultExpanded: true,
      isSetCompleted: (_exerciseIndex, setNumber) => setNumber === 1,
      getCompletedSetsCount: () => 1,
    });

    await user.click(screen.getByRole("checkbox", { name: /Satz 1/ }));
    expect(onToggleSet).toHaveBeenCalledWith({ exerciseIndex: 0, setNumber: 1, completed: false });
  });
});

describe("ExerciseWithSets previous performance", () => {
  const inputs = () => ({
    drafts: new SetPerformanceDraftStore(),
    changeDraft: vi.fn(),
    commit: vi.fn(() => "unchanged" as const),
    copyPrevious: vi.fn(),
  });
  const LAST_TUESDAY: PreviousExercisePerformance = {
    workoutDay: "2026-09-08",
    sets: { 1: { reps: 10, weightKg: 52.5 }, 2: { reps: 8, weightKg: null } },
  };
  const copyButtons = () => screen.queryAllByRole("button", { name: /^Übernehmen für Satz/ });

  it("names the previous workout's date once and references only the set numbers it has", () => {
    const getPreviousExercise = vi.fn((_exerciseIndex: number) => LAST_TUESDAY);
    renderExercise({ defaultExpanded: true, performance: inputs(), getPreviousExercise });

    expect(screen.getAllByText("Zuletzt am 08.09.2026")).toHaveLength(1);
    expect(copyButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Übernehmen für Satz 1: Letztes Mal 10 Wdh. · 52,5 kg",
      "Übernehmen für Satz 2: Letztes Mal 8 Wdh.",
    ]);
    expect(within(screen.getByRole("group", { name: "3. Satz" })).queryByText(/Letztes Mal/)).toBeNull();
    expect(getPreviousExercise.mock.calls.every(([exerciseIndex]) => exerciseIndex === 0)).toBe(true);
  });

  it("stays exactly as before when there is no previous performance", () => {
    renderExercise({ defaultExpanded: true, performance: inputs(), getPreviousExercise: () => undefined });

    expect(screen.queryByText(/Zuletzt am/)).toBeNull();
    expect(screen.queryByText(/Letztes Mal/)).toBeNull();
    expect(copyButtons()).toHaveLength(0);
  });

  it("shows no date when no set number lines up with today's sets", () => {
    renderExercise({
      defaultExpanded: true,
      performance: inputs(),
      getPreviousExercise: () => ({ workoutDay: "2026-09-08", sets: { 5: { reps: 10, weightKg: null } } }),
    });

    expect(screen.queryByText(/Zuletzt am/)).toBeNull();
    expect(copyButtons()).toHaveLength(0);
  });

  it("keeps the reference inside the collapsible sets, not in the header", () => {
    renderExercise({ defaultExpanded: false, performance: inputs(), getPreviousExercise: () => LAST_TUESDAY });

    expect(screen.queryByText(/Zuletzt am/)).toBeNull();
    expect(header()).not.toHaveTextContent(/Letztes Mal|Zuletzt/);
  });
});
