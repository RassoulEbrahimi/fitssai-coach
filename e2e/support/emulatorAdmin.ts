import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { App } from "../../functions/node_modules/firebase-admin/lib/app/index";
import type { Firestore } from "../../functions/node_modules/firebase-admin/lib/firestore/index";
import type { LocalEmulatorEnv } from "./emulatorEnv";

/**
 * The Admin SDK of the Functions workspace, pointed at the local emulators of
 * the demo project and nowhere else. Used by the seed (NUT-13A) and by the
 * NUT-13B browser tests to read what the application persisted.
 *
 * EMULATORS ONLY: callers pass a `LocalEmulatorEnv`, which only
 * `requireLocalEmulatorEnv` produces. The emulator variables are set from it
 * and every credential variable is removed before the SDK is loaded, so there
 * is nothing it could reach production with.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The Functions workspace's own firebase-admin: the copy the activation core imports. */
export const requireFromFunctions = createRequire(path.join(repoRoot, "functions", "package.json"));

type AdminAppModule = typeof import("../../functions/node_modules/firebase-admin/lib/app/index");
type AdminFirestoreModule = typeof import("../../functions/node_modules/firebase-admin/lib/firestore/index");

export const adminFirestoreModule = (): AdminFirestoreModule => requireFromFunctions("firebase-admin/firestore") as AdminFirestoreModule;

export const initEmulatorAdmin = (env: LocalEmulatorEnv, name: string): { app: App; db: Firestore } => {
  // The Admin SDK reads these; they point it at the emulators and nowhere else.
  process.env.FIRESTORE_EMULATOR_HOST = env.firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = env.authHost;
  process.env.GCLOUD_PROJECT = env.projectId;
  // No credentials of any kind: the emulators need none, and production would refuse none.
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const { initializeApp, getApps } = requireFromFunctions("firebase-admin/app") as AdminAppModule;
  const app = getApps().find((candidate) => candidate.name === name) ?? initializeApp({ projectId: env.projectId }, name);
  if (app.options.projectId !== env.projectId) throw new Error("Admin app is not the demo project");
  return { app, db: adminFirestoreModule().getFirestore(app) };
};

export const deleteEmulatorAdmin = async (app: App): Promise<void> => {
  const { deleteApp } = requireFromFunctions("firebase-admin/app") as AdminAppModule;
  await deleteApp(app);
};
