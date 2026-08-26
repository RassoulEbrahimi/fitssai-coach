/**
 * Test double for `@/lib/firebase`.
 *
 * The real module calls `getAuth()` at import time, which throws
 * `auth/invalid-api-key` whenever no Firebase config is present — so merely
 * importing any component that reaches Firebase would fail a test file during
 * collection, before a single test ran.
 *
 * `vitest.config.ts` aliases `@/lib/firebase` to this file, so every test gets
 * inert handles. Nothing here opens a connection or carries credentials;
 * individual tests still mock `firebase/firestore` when they need to control
 * query results.
 */

/** Inert stand-in for the Auth instance. Holds no credentials. */
export const auth = {} as Record<string, never>;

/** Inert stand-in for the Firestore instance. Issues no requests. */
export const db = {} as Record<string, never>;
