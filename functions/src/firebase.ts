import { initializeApp, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * The Admin SDK handles, initialised once per instance.
 *
 * Everything reached through here bypasses Firestore Security Rules. That is
 * the point: quota counters and AI logs must be unwritable by the browser, and
 * a generated plan must be persisted by code the user cannot edit. It is also
 * the hazard — a bug here is not caught by the rules, so the paths this module
 * is used for are deliberately few and each one is tested.
 */

let app: App | undefined;

const adminApp = (): App => {
  if (!app) app = getApps().length > 0 ? getApps()[0] : initializeApp();
  return app;
};

export const db = (): Firestore => getFirestore(adminApp());
