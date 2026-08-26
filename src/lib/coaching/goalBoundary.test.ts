import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import de from "@/messages/de.json";
import {
  FITNESS_GOALS,
  FITNESS_GOAL_OPTIONS,
  fitnessGoalLabel,
  normaliseFitnessGoal,
} from "./fitnessGoal";

/**
 * The goal vocabulary must exist once.
 *
 * Before PR49 there were three: onboarding's camelCase, the profile dialog's
 * snake_case and the admin panel's kebab-case label map — so a profile saved in
 * one era rendered as a raw identifier, or not at all, in another.
 */

const catalogue = de.onboarding.goals as Record<string, string>;

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf-8");

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("one canonical goal vocabulary", () => {
  it("labels every canonical goal exactly as the German catalogue does", () => {
    for (const goal of FITNESS_GOALS) {
      expect(fitnessGoalLabel(goal)).toBe(catalogue[goal]);
    }
  });

  it("understands every spelling the catalogue itself carries", () => {
    for (const key of Object.keys(catalogue)) {
      expect(normaliseFitnessGoal(key)).toBeDefined();
      expect(fitnessGoalLabel(key)).toBe(catalogue[key]);
    }
  });

  it("offers only canonical values for new writes", () => {
    expect(FITNESS_GOAL_OPTIONS.map((option) => option.value)).toEqual([...FITNESS_GOALS]);
  });
});

describe("no second definition survives", () => {
  const LEGACY_VALUES = /["'](muscle_gain|weight_loss|endurance|maintenance)["']/;

  it.each([
    "src/views/ProfileView.tsx",
    "src/pages/AdminPanel.tsx",
    "src/components/ProfileCard.tsx",
  ])("%s writes no legacy goal spelling", (file) => {
    expect(stripComments(read(file))).not.toMatch(LEGACY_VALUES);
  });

  it.each(["src/views/ProfileView.tsx", "src/pages/AdminPanel.tsx"])(
    "%s keeps no goal label map of its own",
    (file) => {
      const code = stripComments(read(file));

      // A local map would drift from the catalogue the moment either changed.
      for (const label of Object.values(catalogue)) {
        expect(code).not.toContain(label);
      }
    }
  );

  it("the profile goal dialog is driven by the shared options", () => {
    expect(read("src/views/ProfileView.tsx")).toMatch(/FITNESS_GOAL_OPTIONS/);
  });
});
