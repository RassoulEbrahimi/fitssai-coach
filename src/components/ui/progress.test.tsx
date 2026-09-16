import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Progress } from "./progress";

/*
  The shared wrapper drew `value` but never handed it to Radix, so every bar
  was announced as indeterminate. What is drawn and what is announced must
  now come from the same number.
*/
const indicator = (bar: HTMLElement) => bar.firstElementChild as HTMLElement;

describe("Progress", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [0, "loading", "translateX(-100%)"],
    [19, "loading", "translateX(-81%)"],
    [100, "complete", "translateX(-0%)"],
  ])("forwards value %i to the Radix root", (value, state, transform) => {
    render(<Progress value={value} aria-label="Fortschritt" />);
    const bar = screen.getByRole("progressbar", { name: "Fortschritt" });

    expect(bar).toHaveAttribute("aria-valuenow", String(value));
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", `${value}%`);
    expect(bar).toHaveAttribute("data-state", state);
    expect(bar).toHaveAttribute("data-value", String(value));
    expect(indicator(bar)).toHaveAttribute("data-state", state);
    expect(indicator(bar).style.transform).toBe(transform);
  });

  it("stays indeterminate, and empty, without a value", () => {
    render(<Progress aria-label="Laden" />);
    const bar = screen.getByRole("progressbar", { name: "Laden" });

    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).not.toHaveAttribute("aria-valuetext");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
    expect(indicator(bar).style.transform).toBe("translateX(-100%)");
  });

  it.each([
    [140, "100", "complete", "translateX(-0%)"],
    [-5, "0", "loading", "translateX(-100%)"],
  ])("bounds %i to the scale instead of letting Radix reject it", (value, now, state, transform) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Progress value={value} aria-label="Fortschritt" />);
    const bar = screen.getByRole("progressbar");

    expect(bar).toHaveAttribute("aria-valuenow", now);
    expect(bar).toHaveAttribute("data-state", state);
    expect(indicator(bar).style.transform).toBe(transform);
    expect(error).not.toHaveBeenCalled();
  });

  it("treats NaN as unknown rather than as a value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Progress value={Number.NaN} aria-label="Fortschritt" />);
    const bar = screen.getByRole("progressbar");

    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
    expect(indicator(bar).style.transform).toBe("translateX(-100%)");
    expect(error).not.toHaveBeenCalled();
  });

  it("draws and announces a custom max from the same scale", () => {
    render(<Progress value={2} max={4} aria-label="Schritte" />);
    const bar = screen.getByRole("progressbar", { name: "Schritte" });

    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(bar).toHaveAttribute("aria-valuetext", "50%");
    expect(indicator(bar).style.transform).toBe("translateX(-50%)");
  });

  it("lets callers hide a decorative bar or state their own scale", () => {
    render(
      <>
        <Progress value={67} aria-hidden="true" data-testid="decorative" />
        <Progress value={50} aria-label="Einrichtung" aria-valuenow={2} aria-valuemax={4} aria-valuetext="Schritt 2 von 4" />
      </>
    );

    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    const decorative = screen.getByTestId("decorative");
    expect(decorative).toHaveAttribute("aria-hidden", "true");
    expect(decorative).toHaveAttribute("aria-valuenow", "67");
    expect(indicator(decorative).style.transform).toBe("translateX(-33%)");

    const steps = screen.getByRole("progressbar", { name: "Einrichtung" });
    expect(steps).toHaveAttribute("aria-valuenow", "2");
    expect(steps).toHaveAttribute("aria-valuemax", "4");
    expect(steps).toHaveAttribute("aria-valuetext", "Schritt 2 von 4");
    expect(indicator(steps).style.transform).toBe("translateX(-50%)");
  });

  it("keeps the caller's size and track classes", () => {
    render(<Progress value={10} className="h-1.5 bg-muted" aria-label="Fortschritt" />);
    const bar = screen.getByRole("progressbar");

    expect(bar.className).toMatch(/\bh-1\.5\b/);
    expect(bar.className).toMatch(/\bbg-muted\b/);
    expect(bar.className).not.toMatch(/\bh-4\b/);
    expect(bar.className).toMatch(/\brounded-full\b/);
  });
});
