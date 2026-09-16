import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/lib/i18n";
import ActiveWorkoutSession from "./ActiveWorkoutSession";
import type { ExecutionProgress } from "@/hooks/useWorkoutExecution";
import type { ExecutionExercise } from "@/lib/workoutExecution";

/*
  TRAINING-UI-04: the session status above the exercise list. State, elapsed
  time and set count on one line, and one labelled progress bar under it.
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
