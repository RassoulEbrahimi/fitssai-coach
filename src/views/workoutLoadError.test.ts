import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Source-level guards for the Workout page load-error banner.
 *
 * The banner's condition and the Firestore imports it depends on are wired
 * inside a very large component that cannot be mounted in isolation, so these
 * assert on the source. They fail the moment either regression returns.
 */
const read = (rel: string) =>
  readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

const workoutView = read("src/views/WorkoutView.tsx");

describe("WorkoutView Firestore usage", () => {
  it("imports every Firestore symbol it calls", () => {
    // Regression: collection/getDocs/query/db/getDoc/doc were used without
    // being imported, so every query from this file threw
    // "collection is not defined" at runtime.
    const importLine = workoutView.match(
      /import \{([^}]*)\} from ["']firebase\/firestore["'];/
    );
    expect(importLine).not.toBeNull();
    const imported = importLine![1].split(",").map((n) => n.trim());

    for (const symbol of ["collection", "doc", "getDoc", "getDocs", "query", "where", "Timestamp"]) {
      expect(imported).toContain(symbol);
    }
    expect(workoutView).toMatch(/import \{ db \} from ["']@\/lib\/firebase["'];/);
  });

  it("no longer dynamically imports a type as a runtime value", () => {
    // CompletionKey is a type-only export; destructuring it yielded undefined.
    expect(workoutView).not.toMatch(/const \{ CompletionKey \} = await import/);
  });

  it("preserves the plan's created_at instead of blanking it", () => {
    // created_at anchors the plan-day resolution and the four-week lifecycle.
    expect(workoutView).not.toMatch(/created_at:\s*''/);
    expect(workoutView).toMatch(/d\.createdAt instanceof Timestamp/);
  });
});

describe("load-error banner condition", () => {
  it("requires a genuine, blocking failure", () => {
    const condition = workoutView.match(/const showLoadError =\s*([^;]+);/);
    expect(condition).not.toBeNull();
    const expr = condition![1].replace(/\s+/g, " ");

    expect(expr).toContain("isCompletionError");
    // Not while offline — the offline banner already covers that.
    expect(expr).toContain("isOnline");
    // Not while still loading.
    expect(expr).toContain("!isLoadingCompletion");
    // Not when usable (cached) completion data is already on screen.
    expect(expr).toContain("!hasCompletionData");
  });

  it("renders the banner from the narrowed condition, not the raw error", () => {
    expect(workoutView).toMatch(/\{showLoadError && \(/);
    expect(workoutView).not.toMatch(/\{isCompletionError && \(/);
  });

  it("names what actually failed", () => {
    // The plan itself loads fine — the completed-plan notice below proves it;
    // it is the week completion data that failed.
    expect(workoutView).not.toContain("Fehler beim Laden des Trainingsplans");
    expect(workoutView).toContain("Trainingsfortschritt konnte nicht geladen werden");
  });
});

describe("useWeekCompletion hook order", () => {
  const hook = read("src/hooks/useWeekCompletion.tsx");

  it("calls useMemo before the isInvalidWeek early return", () => {
    // A conditional hook changes the hook count between renders and throws.
    const memoAt = hook.indexOf("const completionMap = useMemo");
    const returnAt = hook.indexOf("if (isInvalidWeek) {");
    expect(memoAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(-1);
    expect(memoAt).toBeLessThan(returnAt);
  });
});
