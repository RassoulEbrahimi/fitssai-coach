/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected by vite.config.ts: the Git commit this bundle was built from. */
declare const __FITSSAI_BUILD_SHA__: string;

/** Injected by vite.config.ts: the version field from package.json. */
declare const __FITSSAI_APP_VERSION__: string;

/** Firebase emulator routing for the local E2E harness; see src/lib/firebaseEmulators.ts. */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_USE_EMULATORS?: string;
  readonly VITE_FIREBASE_EMULATOR_HOST?: string;
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_PORT?: string;
  readonly VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT?: string;
}
