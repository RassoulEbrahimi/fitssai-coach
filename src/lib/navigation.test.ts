import { describe, it, expect } from "vitest";
import { parseHashRoute, getViewForRoute, getRouteForView } from "./navigation";

describe("parseHashRoute", () => {
  it("resolves the root hash to dashboard", () => {
    expect(parseHashRoute("").view).toBe("dashboard");
    expect(parseHashRoute("#").view).toBe("dashboard");
    expect(parseHashRoute("#/").view).toBe("dashboard");
  });

  it("resolves each plain view route", () => {
    expect(parseHashRoute("#/workout").view).toBe("workout");
    expect(parseHashRoute("#/nutrition").view).toBe("nutrition");
    expect(parseHashRoute("#/profile").view).toBe("profile");
  });

  it("resolves a route that carries a query string", () => {
    // Regression: the whole hash used to be compared against the route
    // table, so any deep link with parameters fell back to dashboard.
    expect(parseHashRoute("#/workout?w=2&d=3").view).toBe("workout");
    expect(parseHashRoute("#/profile?tab=stats").view).toBe("profile");
  });

  it("exposes the query parameters", () => {
    const { params } = parseHashRoute("#/workout?w=2&d=3");
    expect(params.get("w")).toBe("2");
    expect(params.get("d")).toBe("3");
  });

  it("returns empty params when there is no query string", () => {
    const { params } = parseHashRoute("#/workout");
    expect(params.get("w")).toBeNull();
    expect([...params.keys()]).toHaveLength(0);
  });

  it("handles a day index of 0 without losing it", () => {
    const { params } = parseHashRoute("#/workout?w=1&d=0");
    expect(params.get("d")).toBe("0");
    expect(Number(params.get("d"))).toBe(0);
  });

  it("is case-insensitive on the path", () => {
    expect(parseHashRoute("#/WORKOUT?w=1").view).toBe("workout");
  });

  it("tolerates a trailing slash", () => {
    expect(parseHashRoute("#/workout/").view).toBe("workout");
    expect(parseHashRoute("#/workout/?w=2").view).toBe("workout");
  });

  it("falls back to dashboard for unknown routes, keeping params", () => {
    const { view, params } = parseHashRoute("#/nope?w=9");
    expect(view).toBe("dashboard");
    expect(params.get("w")).toBe("9");
  });

  it("does not treat a query-only hash as a route", () => {
    expect(parseHashRoute("#?w=2").view).toBe("dashboard");
  });
});

describe("route round-trip", () => {
  it("getViewForRoute agrees with parseHashRoute", () => {
    for (const hash of ["#/", "#/workout", "#/nutrition", "#/profile", "#/workout?w=4&d=6"]) {
      expect(getViewForRoute(hash)).toBe(parseHashRoute(hash).view);
    }
  });

  it("every view's own route resolves back to it", () => {
    for (const view of ["dashboard", "workout", "nutrition", "profile"] as const) {
      expect(getViewForRoute(`#${getRouteForView(view)}`)).toBe(view);
    }
  });
});
