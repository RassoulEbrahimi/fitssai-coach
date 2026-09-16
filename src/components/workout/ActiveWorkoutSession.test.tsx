import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import ActiveWorkoutSession from "./ActiveWorkoutSession";
import type { ExecutionProgress } from "@/hooks/useWorkoutExecution";
import type { ExecutionExercise } from "@/lib/workoutExecution";

/*
  TRAINING-UI-04: the session status above the exercise list. State, elapsed
  time and set count on one line, and one labelled progress bar under it.
  TRAINING-UI-05: the finish action after the list, further down.
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
  TRAINING-UI-05: the finish action. One primary control after the exercise
  list, whatever the progress. It only asks TodayWorkoutCard for the summary;
  nothing is saved until the summary is confirmed.
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
  it("sticks to the scrollport bottom in the page layer, never as a fixed overlay", () => {
    const [bar] = blocks(".workout-finish");

    expect(bar).toMatch(/position:\s*sticky;/);
    expect(bar).toMatch(/\bbottom:\s*0;/);
    expect(bar).toMatch(/z-index:\s*1;/);
    expect(bar).not.toMatch(/box-shadow|backdrop-filter/);
    expect(presentationCss).not.toMatch(/position:\s*fixed/);
  });

  it("clears the bottom navigation on the Dashboard and the home indicator in Focus Mode", () => {
    const [dashboard] = blocks(".workout-session");
    const [focus] = blocks(".workout-focus-layer .workout-session");
    const [bar] = blocks(".workout-finish");

    // The bar covers the navigation reserve below the button without adding it to the layout.
    expect(bar).toMatch(/padding-bottom:\s*calc\(var\(--workout-finish-pad\) \+ var\(--workout-finish-inset\)\);/);
    expect(bar).toMatch(/margin-bottom:\s*calc\(-1 \* var\(--workout-finish-inset\)\);/);
    expect(dashboard).toMatch(/--workout-finish-inset:\s*calc\(var\(--bottom-nav-offset\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(dashboard).toMatch(/--workout-finish-surface:\s*var\(--card\);/);
    expect(focus).toMatch(/--workout-finish-inset:\s*0px;/);
    expect(focus).toMatch(/--workout-finish-pad:\s*max\(0\.75rem, env\(safe-area-inset-bottom, 0px\)\);/);
    expect(focus).toMatch(/--workout-finish-surface:\s*var\(--background\);/);
  });

  it("keeps focused workout controls scrolled clear of the bar", () => {
    const [margin] = blocks(".workout-session-list :is(button, input)");

    expect(margin).toMatch(/scroll-margin-bottom:\s*calc\(var\(--workout-finish-inset\) \+ var\(--workout-finish-height\)/);
  });

  it("stays in normal flow on desktop and on short landscape screens", () => {
    const media = mediaBlock("(min-width: 64rem), (max-height: 29.99rem)");
    const [bar] = blocks(".workout-finish", media);

    expect(bar).toMatch(/position:\s*static;/);
    expect(bar).toMatch(/padding-bottom:\s*var\(--workout-finish-pad\);/);
    expect(bar).toMatch(/margin-bottom:\s*0;/);
  });

  it("lets the Dashboard card clip without becoming the sticky scroll container", () => {
    const [clip] = blocks(".workout-card-clip");
    const dashboardCard = cardSource.match(/: "border-border [^"]*"/)?.[0] ?? "";

    expect(clip).toMatch(/overflow:\s*hidden;\s*overflow:\s*clip;/);
    expect(dashboardCard).toContain("workout-card-clip");
    expect(dashboardCard).not.toContain("overflow-hidden");
    expect(cardSource).toMatch(/"workout-focus-layer fixed inset-0 [^"]*overflow-y-auto/);
  });
});
