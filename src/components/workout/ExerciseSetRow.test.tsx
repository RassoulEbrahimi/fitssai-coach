import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExerciseSetRow from "./ExerciseSetRow";

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
