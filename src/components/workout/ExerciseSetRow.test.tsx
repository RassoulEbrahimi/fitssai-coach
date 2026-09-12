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
