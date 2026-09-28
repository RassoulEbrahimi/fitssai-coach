import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_EMULATOR_PORTS, E2E_PROJECT_ID } from "../support/emulatorEnv";
import { REPO_ROOT, e2eLanHost, emulatorProcessEnv, lanAddresses, loadLocalE2EEnvFile } from "../support/processEnv";

/**
 * Start the Auth, Firestore and Functions emulators for the demo project and
 * keep them running (manual, headed or phone checks). Builds the Functions
 * first, so the emulator serves the current code with its closed AI gate.
 *
 *   npm run e2e:emulators              loopback only (127.0.0.1)
 *   npm run e2e:emulators:lan          also reachable from this LAN (phone)
 *
 * The project is always `demo-fitssai`, and the CLI runs without any Google
 * credentials (see `emulatorProcessEnv`).
 */

loadLocalE2EEnvFile();
const lan = process.argv.includes("--lan");

const build = spawnSync("npm run build:functions", { cwd: REPO_ROOT, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const args = ["firebase", "emulators:start", "--only", "auth,firestore,functions", "--project", E2E_PROJECT_ID];

if (lan) {
  // The Firebase CLI has no host flag, so the LAN variant is firebase.json with
  // every emulator bound to all interfaces, written to an ignored directory.
  // It sits next to firebase.json (the CLI refuses sources outside the config's
  // directory), named `*.local` so it is gitignored.
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, "firebase.json"), "utf8"));
  for (const name of ["auth", "firestore", "functions"] as const) {
    config.emulators[name] = { host: "0.0.0.0", port: E2E_EMULATOR_PORTS[name] };
  }
  const file = path.join(REPO_ROOT, "firebase.e2e-lan.local");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  args.push("--config", `"${file}"`);
  // Informational only: binding to all interfaces needs no host, the client (e2e:client:lan) does.
  const hosts = process.env.E2E_EMULATOR_HOST ? [e2eLanHost()] : lanAddresses();
  console.log(`LAN mode: emulators listen on all interfaces. This machine's LAN address(es): ${hosts.join(", ") || "none found"}`);
}

const child = spawn(args.join(" "), { cwd: REPO_ROOT, stdio: "inherit", shell: true, env: emulatorProcessEnv() });
child.on("exit", (code) => process.exit(code ?? 0));
