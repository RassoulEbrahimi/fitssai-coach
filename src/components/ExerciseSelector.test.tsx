import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** The catalogue Firestore would return, including an unknown muscle group. */
const CATALOGUE = [
  { id: "1", name: "Bankdrücken", target_muscle: "Chest", category: "Grundübung" },
  { id: "2", name: "Klimmzüge", target_muscle: "Back", category: "Eigengewicht" },
  { id: "3", name: "Bizepscurls", target_muscle: "Biceps", category: "Isolation" },
  { id: "4", name: "Kniebeuge", target_muscle: "Legs", category: "Grundübung" },
  { id: "5", name: "Beinbeuger", target_muscle: "Legs", category: "Maschine" },
  { id: "6", name: "Kreuzheben", target_muscle: "Legs", category: "Grundübung" },
  { id: "7", name: "Crunches", target_muscle: "Abs", category: "Eigengewicht" },
  { id: "8", name: "Rückenstrecker", target_muscle: "Abs", category: "Eigengewicht" },
  { id: "9", name: "Farmers Walk", target_muscle: "Grip", category: "Sonstiges" },
];

vi.mock("@/lib/firebase", () => ({ auth: {}, db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  getDocs: vi.fn(async () => ({
    docs: CATALOGUE.map((ex) => ({ id: ex.id, data: () => ex })),
  })),
}));

import { ExerciseSelector } from "./ExerciseSelector";

const renderSelector = async (onSelect = vi.fn()) => {
  const result = render(<ExerciseSelector onSelect={onSelect} />);
  await waitFor(() =>
    expect(screen.queryByText("Übungen laden...")).not.toBeInTheDocument()
  );
  return { ...result, onSelect };
};

const visibleExerciseNames = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[cmdk-item]'))
    .map((el) => el.getAttribute("data-value") ?? "")
    .filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("category controls", () => {
  it("exposes exactly Push and Pull, in that order", async () => {
    await renderSelector();

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Push", "Pull"]);
  });

  it("no longer offers the old muscle-group categories", async () => {
    const { container } = await renderSelector();

    for (const stale of ["Oberkörper", "Core"]) {
      expect(screen.queryByRole("tab", { name: stale })).not.toBeInTheDocument();
    }
    // "Beine" survives as a group heading inside the list, but not as a tab.
    expect(screen.queryByRole("tab", { name: "Beine" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it("opens on Push", async () => {
    await renderSelector();

    expect(screen.getByRole("tab", { name: "Push" })).toHaveAttribute("data-state", "active");
  });
});

describe("filtering", () => {
  it("shows push exercises under Push", async () => {
    const { container } = await renderSelector();

    const names = visibleExerciseNames(container);
    expect(names).toEqual(
      expect.arrayContaining(["Bankdrücken", "Kniebeuge", "Crunches", "Farmers Walk"])
    );
    expect(names).not.toContain("Klimmzüge");
    expect(names).not.toContain("Kreuzheben");
  });

  it("shows pull exercises under Pull", async () => {
    const user = userEvent.setup();
    const { container } = await renderSelector();

    await user.click(screen.getByRole("tab", { name: "Pull" }));

    await waitFor(() => {
      const names = visibleExerciseNames(container);
      expect(names).toEqual(
        expect.arrayContaining(["Klimmzüge", "Bizepscurls", "Kreuzheben", "Beinbeuger", "Rückenstrecker"])
      );
      expect(names).not.toContain("Bankdrücken");
    });
  });

  it("loses no exercise across the two categories", async () => {
    const user = userEvent.setup();
    const { container } = await renderSelector();

    const push = visibleExerciseNames(container);
    await user.click(screen.getByRole("tab", { name: "Pull" }));
    await waitFor(() => expect(visibleExerciseNames(container)).not.toEqual(push));
    const pull = visibleExerciseNames(container);

    const seen = new Set([...push, ...pull]);
    for (const exercise of CATALOGUE) {
      expect(seen).toContain(exercise.name);
    }
    expect(push.length + pull.length).toBe(CATALOGUE.length);
  });

  it("keeps leg and core work reachable", async () => {
    const user = userEvent.setup();
    const { container } = await renderSelector();

    const push = visibleExerciseNames(container);
    await user.click(screen.getByRole("tab", { name: "Pull" }));
    await waitFor(() => expect(visibleExerciseNames(container)).not.toEqual(push));
    const pull = visibleExerciseNames(container);
    const seen = new Set([...push, ...pull]);

    for (const legOrCore of [
      "Kniebeuge",
      "Beinbeuger",
      "Kreuzheben",
      "Crunches",
      "Rückenstrecker",
    ]) {
      expect(seen).toContain(legOrCore);
    }
  });
});

describe("search", () => {
  it("finds an exercise from the inactive category", async () => {
    // Current UX: search spans the whole catalogue, ignoring the active tab.
    const user = userEvent.setup();
    const { container } = await renderSelector();

    await user.type(screen.getByPlaceholderText("Übung suchen..."), "Klimm");

    await waitFor(() => expect(visibleExerciseNames(container)).toContain("Klimmzüge"));
  });
});

describe("selection", () => {
  it("passes the chosen exercise straight through", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    await renderSelector(onSelect);

    await user.click(screen.getByText("Bankdrücken"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "1", name: "Bankdrücken" });
  });
});
