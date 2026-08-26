import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * The hero header sits on a photo and uses white text. Its scrim must not be
 * built from theme tokens: `background` is white in light mode, which put
 * white text on a white gradient.
 */
const source = readFileSync(
  resolve(__dirname, "..", "..", "src/components/TodayWorkoutCard.tsx"),
  "utf8"
);

/*
 * Scope to the hero header block only. The rest-day hero and the blurred
 * preview also use gradient scrims, but those pair a theme fade with
 * theme-aware text (or no text), which is correct in both themes.
 */
const heroBlock = source.slice(
  source.indexOf("{/* Hero Header Section */}"),
  source.indexOf("{/* Content Section */}")
);
const heroOverlay =
  heroBlock.match(/<div className="absolute inset-0 bg-gradient-to-t[^"]*"/)?.[0] ?? "";

describe("Tägliches Training hero contrast", () => {
  it("has a hero scrim", () => {
    expect(heroOverlay).not.toBe("");
  });

  it("does not build the scrim from theme background tokens", () => {
    // Regression: from-background/via-background resolve to white in light
    // mode, so the white title and metadata disappeared.
    expect(heroOverlay).not.toContain("from-background");
    expect(heroOverlay).not.toContain("via-background");
    expect(heroOverlay).not.toContain("from-card");
  });

  it("uses a fixed dark scrim so white text reads in both themes", () => {
    expect(heroOverlay).toMatch(/from-(zinc|neutral|slate|gray|black)/);
    expect(heroOverlay).toMatch(/via-(zinc|neutral|slate|gray|black)/);
  });

  it("keeps the white-on-photo treatment for title and metadata", () => {
    expect(heroBlock).toMatch(/<h2 className="[^"]*text-white[^"]*">/);
    expect(heroBlock).toMatch(/text-white\/9\d/);
  });

  it("leaves the theme-aware scrims that pair with theme-aware text alone", () => {
    // The rest-day hero uses text-foreground over from-background: correct.
    expect(source).toContain('from-background via-background/80 to-transparent');
    expect(source).toMatch(/<h2 className="text-xl font-bold text-foreground">/);
  });

  it("does not use primary-foreground on the date badge", () => {
    // --primary-foreground is near-white in BOTH themes, so it was unreadable
    // on the light treatment.
    const badge = heroBlock.match(/className="w-fit mb-2[^"]*"/)?.[0] ?? "";
    expect(badge).not.toBe("");
    expect(badge).not.toContain("text-primary-foreground");
    expect(badge).toContain("text-white");
  });
});
