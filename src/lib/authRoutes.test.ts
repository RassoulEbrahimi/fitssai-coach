import { describe, it, expect } from "vitest";
import { authModeFromRouteParam, authPathForMode, routeParamForAuthMode } from "./authRoutes";

describe("authModeFromRouteParam", () => {
  it("maps /auth/sign-in to the login form", () => {
    expect(authModeFromRouteParam("sign-in")).toBe("login");
  });

  it("maps /auth/sign-up to the registration form", () => {
    // Regression: AuthPage ignored the param entirely, so /auth/sign-up
    // rendered the sign-in form.
    expect(authModeFromRouteParam("sign-up")).toBe("signup");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(authModeFromRouteParam("Sign-Up")).toBe("signup");
    expect(authModeFromRouteParam("  sign-up  ")).toBe("signup");
  });

  it("tolerates common near-miss spellings", () => {
    expect(authModeFromRouteParam("signup")).toBe("signup");
    expect(authModeFromRouteParam("register")).toBe("signup");
    expect(authModeFromRouteParam("signin")).toBe("login");
    expect(authModeFromRouteParam("login")).toBe("login");
  });

  it("falls back safely for unknown or missing modes", () => {
    expect(authModeFromRouteParam("nonsense")).toBe("login");
    expect(authModeFromRouteParam("")).toBe("login");
    expect(authModeFromRouteParam(undefined)).toBe("login");
    expect(authModeFromRouteParam(null)).toBe("login");
  });
});

describe("route generation", () => {
  it("maps modes back to their route segment", () => {
    expect(routeParamForAuthMode("login")).toBe("sign-in");
    expect(routeParamForAuthMode("signup")).toBe("sign-up");
  });

  it("treats forgot-password as a state of the sign-in route", () => {
    expect(routeParamForAuthMode("forgot")).toBe("sign-in");
  });

  it("builds full paths", () => {
    expect(authPathForMode("login")).toBe("/auth/sign-in");
    expect(authPathForMode("signup")).toBe("/auth/sign-up");
  });

  it("round-trips every mode", () => {
    for (const mode of ["login", "signup"] as const) {
      expect(authModeFromRouteParam(routeParamForAuthMode(mode))).toBe(mode);
    }
  });
});
