import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import EmeraldSplash from "./EmeraldSplash";

describe("EmeraldSplash", () => {
  it("loads the logo from the deployment base, not the domain root", () => {
    render(<EmeraldSplash onFinish={vi.fn()} />);

    const logo = screen.getByAltText("FitssAI");
    const src = logo.getAttribute("src") ?? "";

    /*
      GitHub Pages serves the app from /fitssai-coach/, so "/icons/..." would
      404 against the domain root. The base has to be part of the URL.
    */
    expect(src).toBe(`${import.meta.env.BASE_URL}icons/fitssai-512.png`);
    expect(src).toBe("/fitssai-coach/icons/fitssai-512.png");
    expect(src.startsWith("/icons/")).toBe(false);
  });
});
