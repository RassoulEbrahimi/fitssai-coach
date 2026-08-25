/**
 * Mapping between the `/auth/:mode` route segment and the auth form mode.
 *
 * Kept separate from the components so both the page and the flow agree on a
 * single definition, and so the fallback behaviour is directly testable.
 */

export type AuthMode = "login" | "signup" | "forgot";

const ROUTE_TO_MODE: Record<string, AuthMode> = {
  "sign-in": "login",
  "sign-up": "signup",
  // Tolerate the un-hyphenated spellings rather than silently showing the
  // wrong form for a near-miss URL.
  signin: "login",
  signup: "signup",
  login: "login",
  register: "signup",
};

const MODE_TO_ROUTE: Record<AuthMode, string> = {
  login: "sign-in",
  signup: "sign-up",
  // "forgot" is a state inside the sign-in form, not its own route.
  forgot: "sign-in",
};

/** Unknown or missing segments fall back to the sign-in form. */
export const authModeFromRouteParam = (param: string | undefined | null): AuthMode => {
  if (typeof param !== "string") return "login";
  return ROUTE_TO_MODE[param.trim().toLowerCase()] ?? "login";
};

export const routeParamForAuthMode = (mode: AuthMode): string => MODE_TO_ROUTE[mode] ?? "sign-in";

export const authPathForMode = (mode: AuthMode): string => `/auth/${routeParamForAuthMode(mode)}`;
