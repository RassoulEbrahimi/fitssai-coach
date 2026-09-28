import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_ROOT, e2eClientPort, e2eClientEnv, e2eEmulatorHost, e2eLanHost, loadLocalE2EEnvFile } from "../support/processEnv";

/**
 * Serve the real app from the Vite dev server with Firebase emulator routing.
 *
 *   npm run e2e:client              http://127.0.0.1:5180/fitssai-coach/
 *   npm run e2e:client:lan          reachable from a phone on this LAN
 *
 * The browser bootstrap (src/lib/firebaseEmulators.ts) checks this
 * configuration again and refuses to start if it could reach production.
 */

loadLocalE2EEnvFile();
const lan = process.argv.includes("--lan");
const emulatorHost = lan ? e2eLanHost() : e2eEmulatorHost();
const port = e2eClientPort();
const listen = lan ? "0.0.0.0" : "127.0.0.1";

console.log(`E2E client: http://${lan ? emulatorHost : "127.0.0.1"}:${port}/fitssai-coach/ (emulators at ${emulatorHost})`);

const vite = path.join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
const child = spawn(
  process.execPath,
  [vite, "--mode", "e2e", "--host", listen, "--port", String(port), "--strictPort"],
  { cwd: REPO_ROOT, stdio: "inherit", env: e2eClientEnv(emulatorHost) }
);
child.on("exit", (code) => process.exit(code ?? 0));
