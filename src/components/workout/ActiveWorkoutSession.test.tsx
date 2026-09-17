import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/lib/i18n";
import ActiveWorkoutSession from "./ActiveWorkoutSession";
import { SetPerformanceDraftStore, setPerformanceKey } from "@/lib/setPerformanceDrafts";
import type { ExecutionProgress } from "@/hooks/useWorkoutExecution";
import type { ExecutionExercise } from "@/lib/workoutExecution";

/*
  TRAINING-UI-04: the session status above the exercise list. State, elapsed
  time and set count on one line, and one labelled progress bar under it.
  TRAINING-UI-06: one open exercise at a time, and the finish action at the end
  of the list rather than stuck to the bottom of the screen.
*/

const idleTimerState = {
  status: "idle" as const,
  deadlineMs: null,
  pausedRemainingSeconds: null,
  exerciseIndex: null,
  setNumber: null,
  remainingSeconds: 0,
  totalRestSeconds: 0,
  isComplete: false,
};

const EXERCISES: ExecutionExercise[] = [
  { name: "Bankdrücken", sets: 4, reps: 10, rest: "90s" },
  { name: "Kniebeugen", sets: 22, reps: 8, rest: "60s" },
];

const progressOf = (completedSets: number, totalSets = 26): ExecutionProgress => {
  const progressPercent = Math.round((completedSets / totalSets) * 100);
  return { completedSets, totalSets, progressPercent, isComplete: progressPercent === 100 };
};

const props = (overrides: Partial<React.ComponentProps<typeof ActiveWorkoutSession>> = {}) => ({
  exercises: EXERCISES,
  progress: progressOf(5),
  durationSeconds: 1051,
  isSetCompleted: () => false,
  getCompletedSetsCount: () => 0,
  onToggleSet: vi.fn(),
  isTogglingSet: false,
  rest: { timerState: idleTimerState, isSheetOpen: false, setSheetOpen: vi.fn() },
  onFinish: vi.fn(),
  ...overrides,
});

const renderSession = (overrides: Partial<React.ComponentProps<typeof ActiveWorkoutSession>> = {}) =>
  render(<ActiveWorkoutSession {...props(overrides)} />);

const statusBlock = () => document.querySelector<HTMLElement>(".workout-session-status")!;
const statusLine = () => statusBlock().querySelector<HTMLElement>(".workout-session-line")!;
const duration = () => statusBlock().querySelector("time")!;
const sessionProgress = () => screen.getByRole("progressbar", { name: "Trainingsfortschritt" });

describe("ActiveWorkoutSession status header", () => {
  it("states that the training is running, in the primary colour, as the first fact", () => {
    renderSession();
    const state = screen.getByText("Training läuft");

    expect(state).toBeVisible();
    expect(state.closest(".workout-session-line")).toBe(statusLine());
    expect(statusLine().firstElementChild).toBe(state);
    expect(state.className).toMatch(/\btext-primary\b/);
    expect(state.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("heading", { name: /Training läuft/ })).not.toBeInTheDocument();
  });

  it.each([
    [45, "00:45", "PT0M45S"],
    [321, "05:21", "PT5M21S"],
    [3599, "59:59", "PT59M59S"],
    [3600, "60:00", "PT60M0S"],
    [7507, "125:07", "PT125M7S"],
    [19112, "318:32", "PT318M32S"],
  ])("shows %i elapsed seconds as %s, untruncated", (seconds, text, iso) => {
    renderSession({ durationSeconds: seconds });

    expect(duration()).toHaveTextContent(new RegExp(`^${text}$`));
    expect(duration()).toHaveAttribute("datetime", iso);
  });

  it("draws the time in tabular figures with a timer icon instead of the stopwatch emoji", () => {
    renderSession();
    const time = duration().parentElement!;

    expect(time.className).toMatch(/\btabular-nums\b/);
    expect(time.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(time.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(statusBlock().textContent).not.toMatch(/⏱/u);
    expect(document.body.textContent).not.toMatch(/⏱/u);
  });

  it("names the time for screen readers, apart from the other facts, without announcing every tick", () => {
    renderSession();
    const time = duration().parentElement!;

    expect(time).toHaveTextContent(/^, Trainingsdauer 17:31$/);
    expect(time.querySelector(".sr-only")).toHaveTextContent(/^, Trainingsdauer$/);
    expect(statusBlock().querySelector("[aria-live], [role=timer], [role=status]")).toBeNull();
  });

  it("updates the same time in place as the session clock advances", () => {
    const view = renderSession({ durationSeconds: 59 });
    const time = duration();
    expect(time).toHaveTextContent("00:59");

    view.rerender(<ActiveWorkoutSession {...props({ durationSeconds: 60 })} />);
    expect(duration()).toBe(time);
    expect(time).toHaveTextContent("01:00");

    view.rerender(<ActiveWorkoutSession {...props({ durationSeconds: 3601 })} />);
    expect(duration()).toBe(time);
    expect(time).toHaveTextContent("60:01");
  });

  it.each([
    [0, 0],
    [5, 19],
    [26, 100],
  ])("states %i of 26 sets as fact and gives the bar %i%%", (completed, percent) => {
    renderSession({ progress: progressOf(completed) });
    const count = screen.getByText(`${completed}/26 Sätze`);

    expect(count.closest(".workout-session-line")).toBe(statusLine());
    expect(count.className).toMatch(/\btabular-nums\b/);
    expect(count.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(statusLine()).toHaveTextContent(new RegExp(`^Training läuft, Trainingsdauer 17:31, ${completed}/26 Sätze$`));
    expect(statusBlock()).not.toHaveTextContent(/%/);

    expect(sessionProgress()).toHaveAttribute("aria-valuenow", String(percent));
    expect(sessionProgress()).toHaveAttribute("aria-valuemin", "0");
    expect(sessionProgress()).toHaveAttribute("aria-valuemax", "100");
    expect(sessionProgress()).toHaveAttribute("aria-valuetext", `${percent}%`);
    expect(sessionProgress()).toHaveAttribute("data-state", percent === 100 ? "complete" : "loading");
    expect((sessionProgress().firstElementChild as HTMLElement).style.transform)
      .toBe(`translateX(-${100 - percent}%)`);
  });

  it("draws the session bar as a thin rounded line under the status line", () => {
    renderSession();
    const bar = sessionProgress();

    expect(bar.parentElement).toBe(statusBlock());
    expect(bar.previousElementSibling).toBe(statusLine());
    expect(bar.className).toMatch(/\bh-1\.5\b/);
    expect(bar.className).not.toMatch(/\bh-2\b/);
    expect(bar.className).toMatch(/\brounded-full\b/);
    expect(bar).not.toHaveAttribute("aria-hidden");
  });

  it("announces only the session bar; the exercise bars stay decorative", () => {
    renderSession({ getCompletedSetsCount: (index) => (index === 0 ? 2 : 3) });
    const all = screen.getAllByRole("progressbar", { hidden: true });

    expect(screen.getAllByRole("progressbar")).toEqual([sessionProgress()]);
    expect(all).toHaveLength(1 + EXERCISES.length);
    for (const bar of all.filter((bar) => bar !== sessionProgress())) {
      expect(bar).toHaveAttribute("aria-hidden", "true");
      // The shared wrapper now hands the value to Radix for these too.
      expect(bar).toHaveAttribute("data-state", "loading");
    }
  });

  it("keeps the status block free of a card surface of its own", () => {
    renderSession();

    expect(statusBlock().className).not.toMatch(/\b(border|shadow|bg-|rounded|p-\d)/);
    expect(statusBlock().className).toMatch(/\bmb-3\b/);
  });
});

/*
  TRAINING-UI-06: the session owns which exercise is open. Zero or one, never
  two, and opening one closes whichever was open. Nothing else in the session
  moves with it: what was typed, what was recorded and a running rest are all
  held above this component.
*/
const collapseFor = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} `) });
const expandedNames = () =>
  screen.getAllByRole("button", { name: /Sätze$/ })
    .filter((control) => control.getAttribute("aria-expanded") === "true")
    .map((control) => control.getAttribute("aria-label")!.replace(/ \d+\/\d+ Sätze$/, ""));

describe("ActiveWorkoutSession exercise expansion", () => {
  it("opens the first exercise and only that one", () => {
    renderSession();

    expect(expandedNames()).toEqual(["Bankdrücken"]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("closes the open exercise when another one is opened", async () => {
    const user = userEvent.setup();
    renderSession();

    await user.click(collapseFor("Kniebeugen"));

    expect(expandedNames()).toEqual(["Kniebeugen"]);
    expect(collapseFor("Bankdrücken")).toHaveAttribute("aria-expanded", "false");
    // The second exercise's 22 sets, and none of the first's.
    expect(screen.getAllByRole("checkbox")).toHaveLength(22);
  });

  it("closes everything when the open exercise is tapped again", async () => {
    const user = userEvent.setup();
    renderSession();

    await user.click(collapseFor("Bankdrücken"));

    expect(expandedNames()).toEqual([]);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("never leaves two exercises open across repeated switching", async () => {
    const user = userEvent.setup();
    renderSession();

    for (const name of ["Kniebeugen", "Bankdrücken", "Kniebeugen", "Kniebeugen", "Bankdrücken"]) {
      await user.click(collapseFor(name));
      expect(expandedNames().length).toBeLessThanOrEqual(1);
    }
    expect(expandedNames()).toEqual(["Bankdrücken"]);
  });

  it("keeps what was typed and what was recorded when the open exercise changes", async () => {
    const user = userEvent.setup();
    const drafts = new SetPerformanceDraftStore();
    const performance = {
      drafts,
      changeDraft: (exerciseIndex: number, setNumber: number, field: "reps" | "weight", text: string) => {
        const key = setPerformanceKey(exerciseIndex, setNumber);
        drafts.set(key, { ...drafts.get(key), [field]: text });
      },
      commit: vi.fn(() => "unchanged" as const),
    };
    renderSession({
      performance,
      getActualPerformance: (exerciseIndex, setNumber) =>
        exerciseIndex === 0 && setNumber === 2
          ? { source: "user-recorded" as const, reps: 11, weightKg: 47.5 }
          : undefined,
    });

    // A half-typed value in set 1 and a value already recorded for set 2.
    const reps = () => screen.getByRole("textbox", { name: "Wiederholungen für Satz 1" });
    fireEvent.change(reps(), { target: { value: "9" } });
    expect(reps()).toHaveValue("9");

    await user.click(collapseFor("Kniebeugen"));
    await user.click(collapseFor("Bankdrücken"));

    expect(reps()).toHaveValue("9");
    expect(screen.getByRole("textbox", { name: "Wiederholungen für Satz 2" })).toHaveValue("11");
    expect(screen.getByRole("textbox", { name: "Gewicht für Satz 2 in kg" })).toHaveValue("47,5");
    expect(performance.commit).not.toHaveBeenCalled();
  });

  it("leaves a running rest visible on its own exercise, open or not", async () => {
    const user = userEvent.setup();
    const setSheetOpen = vi.fn();
    renderSession({
      rest: {
        timerState: { ...idleTimerState, status: "running", exerciseIndex: 0, setNumber: 1, remainingSeconds: 42, totalRestSeconds: 90, deadlineMs: 42_000 },
        isSheetOpen: false,
        setSheetOpen,
      },
    });
    const inline = () => screen.getByRole("button", { name: "Pause für Satz 1 öffnen" });
    expect(inline()).toBeInTheDocument();

    // Opening the other exercise closes this one; its rest keeps running.
    await user.click(collapseFor("Kniebeugen"));

    expect(inline()).toBeInTheDocument();
    expect(collapseFor("Bankdrücken")).toHaveAttribute("aria-expanded", "false");
    expect(setSheetOpen).not.toHaveBeenCalled();
  });

  it("opens guidance without changing which exercise is open", async () => {
    const user = userEvent.setup();
    renderSession();

    await user.click(screen.getByRole("button", { name: "Informationen zu Kniebeugen" }));
    expect(await screen.findByRole("dialog", { name: "Kniebeugen" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(expandedNames()).toEqual(["Bankdrücken"]);
  });
});

/*
  TRAINING-UI-06: the finish action. One primary control at the end of the
  exercise list, whatever the progress, scrolling with the workout rather than
  held at the bottom of the screen. It only asks TodayWorkoutCard for the
  summary; nothing is saved until the summary is confirmed.
*/
const finishButton = () => screen.getByRole("button", { name: "Training beenden" });
const finishArea = () => document.querySelector<HTMLElement>(".workout-finish")!;
const classes = (element: Element) => element.getAttribute("class")!.split(/\s+/);

describe("ActiveWorkoutSession finish action", () => {
  it.each([
    ["no", 0],
    ["some", 5],
    ["every", 26],
  ])("offers exactly one enabled primary finish control with %s set done", (_done, completed) => {
    renderSession({ progress: progressOf(completed) });
    const button = finishButton();

    expect(screen.getAllByRole("button", { name: /beenden/ })).toEqual([button]);
    expect(button).toHaveTextContent(/^Training beenden$/);
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    // The visible text names it; no aria-label on top.
    expect(button).not.toHaveAttribute("aria-label");
    expect(classes(button)).toEqual(expect.arrayContaining([
      "bg-primary", "text-primary-foreground", "w-full", "h-[3.25rem]", "text-base", "font-semibold",
    ]));
  });

  it("does not look secondary, disabled or destructive while sets are still open", () => {
    renderSession({ progress: progressOf(5) });
    const tokens = classes(finishButton());

    for (const token of ["border", "border-input", "bg-background", "bg-secondary", "opacity-50", "text-muted-foreground"]) {
      expect(tokens).not.toContain(token);
    }
    expect(tokens.some((token) => /^(bg|text|border)-destructive/.test(token))).toBe(false);
    expect(finishButton().querySelector("svg")).toBeNull();
  });

  it("adds only a check once every set is done, with the same name and treatment", () => {
    const view = renderSession({ progress: progressOf(25) });
    const open = finishButton().getAttribute("class");

    view.rerender(<ActiveWorkoutSession {...props({ progress: progressOf(26) })} />);
    const button = finishButton();
    const icon = button.querySelector("svg")!;

    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon.getAttribute("class")).toMatch(/\blucide-check\b/);
    expect(button).toHaveTextContent(/^Training beenden$/);
    expect(button).toHaveAccessibleName("Training beenden");
    expect(button.getAttribute("class")).toBe(open);
    expect(button).toBeEnabled();
  });

  it("asks for the summary once per press and touches nothing else", () => {
    const onFinish = vi.fn();
    const onToggleSet = vi.fn();
    const setSheetOpen = vi.fn();
    renderSession({
      onFinish,
      onToggleSet,
      rest: { timerState: idleTimerState, isSheetOpen: false, setSheetOpen },
    });

    fireEvent.click(finishButton());

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onToggleSet).not.toHaveBeenCalled();
    expect(setSheetOpen).not.toHaveBeenCalled();
    // Still the running workout: the press itself ends nothing.
    expect(screen.getByText("Training läuft")).toBeInTheDocument();
    expect(finishButton()).toBeInTheDocument();
  });

  it("places the action after the exercise list, as the last control, inside the session", () => {
    const view = renderSession();
    const area = finishArea();
    const session = area.parentElement!;
    const list = session.querySelector(".workout-session-list")!;
    const controls = Array.from(session.querySelectorAll<HTMLElement>("button, input, a[href], [tabindex]"))
      .filter((element) => element.tabIndex >= 0);

    expect(view.container.contains(area)).toBe(true);
    expect(session).toHaveClass("workout-session");
    expect(session.lastElementChild).toBe(area);
    expect(area.previousElementSibling).toBe(list);
    expect(Array.from(area.children)).toEqual([finishButton()]);
    expect(controls.at(-1)).toBe(finishButton());
  });

  it("stays in the page layer: no fixed overlay, no z-index class of its own", () => {
    renderSession();

    for (const element of [finishArea(), finishButton()]) {
      const tokens = classes(element);
      expect(tokens).not.toContain("fixed");
      expect(tokens).not.toContain("sticky");
      expect(tokens.some((token) => /^z-/.test(token))).toBe(false);
    }
  });

  it("reaches the end of the workout with nothing below it", () => {
    renderSession();
    const session = finishArea().parentElement!;

    // Nothing follows the action: no spacer, no reserved strip, no second control.
    expect(session.lastElementChild).toBe(finishArea());
    expect(finishArea().nextElementSibling).toBeNull();
    expect(Array.from(finishArea().children)).toEqual([finishButton()]);
    expect(screen.getAllByRole("button", { name: /beenden/ })).toEqual([finishButton()]);
  });
});

/*
  Sticky placement is CSS, which jsdom does not lay out. These pin the
  contract the browser QA measured.
*/
const presentationCss = readFileSync(resolve(__dirname, "workoutPresentation.css"), "utf8");
const cardSource = readFileSync(resolve(__dirname, "..", "TodayWorkoutCard.tsx"), "utf8");
/** Every declaration block written for exactly this selector. */
const blocks = (selector: string, source = presentationCss) => {
  const found: string[] = [];
  const pattern = new RegExp(`(^|[\\s}])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const match of source.matchAll(pattern)) found.push(match[2]);
  return found;
};
const mediaBlock = (query: string) => {
  const start = presentationCss.indexOf(`@media ${query} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = presentationCss.indexOf("{", start); i < presentationCss.length; i += 1) {
    if (presentationCss[i] === "{") depth += 1;
    if (presentationCss[i] === "}") depth -= 1;
    if (depth === 0) return presentationCss.slice(start, i + 1);
  }
  return "";
};

describe("finish action placement contract", () => {
  it("is a plain block at the end of the list: nothing sticky, fixed or layered", () => {
    const [bar] = blocks(".workout-finish");

    expect(bar).toMatch(/margin-top:\s*1rem;/);
    expect(bar).toMatch(/padding-top:\s*0\.75rem;/);
    expect(bar).toMatch(/border-top:\s*1px solid hsl\(var\(--border\)\);/);
    expect(bar).not.toMatch(/position:|bottom:|z-index:|border-image:|box-shadow|backdrop-filter/);
    expect(presentationCss).not.toMatch(/position:\s*(sticky|fixed)/);
  });

  it("leaves no reserve, spacer or negative margin behind the removed bar", () => {
    expect(presentationCss).not.toMatch(/--workout-finish-(surface|inset|pad|height)/);
    expect(presentationCss).not.toMatch(/--bottom-nav-offset/);
    expect(presentationCss).not.toMatch(/margin-bottom:\s*calc\(-/);
    expect(presentationCss).not.toMatch(/scroll-margin-bottom/);
    expect(presentationCss).not.toMatch(/safe-area-inset/);
    // No mode of its own for the action any more.
    expect(blocks(".workout-focus-layer .workout-session")).toHaveLength(0);
    expect(mediaBlock("(min-width: 64rem), (max-height: 29.99rem)")).toBe("");
  });

  it("gives the Dashboard card its ordinary clipping back", () => {
    const dashboardCard = cardSource.match(/: "border-border [^"]*"/)?.[0] ?? "";

    expect(dashboardCard).toContain("overflow-hidden");
    expect(presentationCss).not.toMatch(/workout-card-clip/);
    expect(cardSource).not.toMatch(/workout-card-clip|workout-focus-layer/);
    expect(cardSource).toMatch(/"fixed inset-0 [^"]*overflow-y-auto/);
  });

  /*
    TRAINING-UI-06: the ring is not painted inside the running session. The rule
    is scoped to .workout-session, so the dialogs - which portal to the body -
    keep their own focus handling, and nothing is disabled anywhere else.
  */
  it("stops the focus ring being painted, inside the session only", () => {
    const [ring] = blocks(".workout-session :is(a, button, input, select, textarea, [tabindex]):focus-visible");

    expect(ring).toMatch(/outline:\s*none;/);
    expect(ring).toMatch(/box-shadow:\s*none;/);
    expect(presentationCss).not.toMatch(/:focus-visible\s*\{[^}]*ring/);
    // Nothing unscoped, and nothing that would reach a portalled dialog.
    const selectors = presentationCss.split("\n").filter((line) => line.includes(":focus-visible"));
    expect(selectors).toHaveLength(1);
    expect(selectors[0].trim()).toMatch(/^\.workout-session :is\(/);
  });
});
