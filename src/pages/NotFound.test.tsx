import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import NotFound from "./NotFound";

/*
  The 404 page is mounted under BrowserRouter basename="/fitssai-coach" (see
  App.tsx), which is where GitHub Pages serves the app from. Its "back home"
  link must therefore resolve inside that basename; a root-relative anchor
  would leave the SPA and land on the Pages account root.
*/
describe("NotFound home link", () => {
  it("resolves the home link inside the deployment basename", () => {
    render(
      <MemoryRouter basename="/fitssai-coach" initialEntries={["/fitssai-coach/nope"]}>
        <NotFound />
      </MemoryRouter>
    );

    const home = screen.getByRole("link", { name: /Return to Home/i });
    // React Router renders the basename itself for the index route; what
    // matters is that the href never escapes to the Pages account root.
    expect(home).toHaveAttribute("href", "/fitssai-coach");
  });

  it("keeps the home link inside the SPA when served from the domain root", () => {
    render(
      <MemoryRouter initialEntries={["/nope"]}>
        <NotFound />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Return to Home/i })).toHaveAttribute("href", "/");
  });
});
