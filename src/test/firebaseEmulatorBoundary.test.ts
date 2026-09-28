import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
  NUT-13A: emulator routing lives in ONE place. `connectFirebaseEmulators`
  routes the Functions instance `getFunctions(app, FUNCTIONS_REGION)` returns,
  so every callable must obtain exactly that instance — a callable asking for
  another region or app would silently reach the deployed backend from an E2E
  run. And no other module may connect an emulator on its own.
*/

const SRC = path.resolve(__dirname, "..");

const productionSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === "test" ? [] : productionSources(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });

const sources = productionSources(SRC).map((file) => ({
  file: path.relative(SRC, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

describe("Firebase emulator routing boundary", () => {
  it("every callable obtains Functions as getFunctions(getApp(), FUNCTIONS_REGION)", () => {
    const calls = sources.flatMap(({ file, text }) =>
      // The arguments up to the call's closing parenthesis; `getApp()` is the one nested call allowed.
      [...text.matchAll(/getFunctions\(((?:[^()]|\(\))*)\)/g)].map((match) => ({ file, args: match[1].replace(/\s+/g, " ").trim() }))
    );
    const callables = calls.filter(({ file }) => file !== "lib/firebaseEmulators.ts");
    expect(callables.length).toBeGreaterThan(0);
    expect(callables.filter(({ args }) => args !== "getApp(), FUNCTIONS_REGION")).toEqual([]);
    // The bootstrap routes the same app/region pair.
    expect(calls.filter(({ file }) => file === "lib/firebaseEmulators.ts").map(({ args }) => args)).toContain(
      "app, FUNCTIONS_REGION"
    );
  });

  it("only src/lib/firebaseEmulators.ts connects an emulator", () => {
    const connecting = sources
      .filter(({ text }) => /connect(Auth|Firestore|Functions|Storage|Database)Emulator\(/.test(text))
      .map(({ file }) => file);
    expect(connecting).toEqual(["lib/firebaseEmulators.ts"]);
  });

  it("only src/lib/firebase.ts initialises the Firebase app", () => {
    expect(sources.filter(({ text }) => /\binitializeApp\(/.test(text)).map(({ file }) => file)).toEqual(["lib/firebase.ts"]);
  });
});
