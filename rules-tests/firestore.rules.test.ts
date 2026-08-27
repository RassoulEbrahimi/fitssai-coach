import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

/*
  Firestore Security Rules, exercised against the real rules engine in the
  emulator.

  These are the only tests in the repository that can prove an access-control
  claim. Everything else asserts what our own code does; this asserts what
  Firestore will refuse to do when someone bypasses our code entirely — which
  is the whole threat model. `role` is never written by any client path, so a
  write that touches it did not come from the app.
*/

const ALICE = "alice";
const BOB = "bob";

let testEnv: RulesTestEnvironment;

/** Alice's client, signed in as herself. */
const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const bob = () => testEnv.authenticatedContext(BOB).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

/** The profile fields the current onboarding and Profile flows actually write. */
const PROFILE_FIELDS = {
  fullName: "Alice",
  age: 30,
  weight: 70,
  height: 175,
  fitnessGoal: "gainMuscle",
  dietaryPreference: "standard",
  experienceLevel: "intermediate",
  equipment: ["dumbbells", "pullup_bar"],
  daysPerWeek: 3,
  sessionMinutes: 60,
};

/** Seed a document bypassing rules, so a test starts from a known state. */
const seed = (path: string[], data: Record<string, unknown>) =>
  testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path.join("/")), data);
  });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // A "demo-" project id is Firebase's guarantee that the emulator needs no
    // credentials and can never reach a real project.
    projectId: "demo-fitssai",
    firestore: {
      rules: readFileSync(join(process.cwd(), "..", "firestore.rules"), "utf-8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("owner access to /users/{userId}", () => {
  it("A. an unauthenticated client cannot read a user document", async () => {
    await seed(["users", ALICE], PROFILE_FIELDS);

    await assertFails(getDoc(doc(anon(), "users", ALICE)));
  });

  it("B. alice can read her own document", async () => {
    await seed(["users", ALICE], PROFILE_FIELDS);

    await assertSucceeds(getDoc(doc(alice(), "users", ALICE)));
  });

  it("C. alice cannot read bob's document", async () => {
    await seed(["users", BOB], PROFILE_FIELDS);

    await assertFails(getDoc(doc(alice(), "users", BOB)));
  });

  it("D. alice can update normal profile fields", async () => {
    await seed(["users", ALICE], PROFILE_FIELDS);

    await assertSucceeds(
      updateDoc(doc(alice(), "users", ALICE), { fullName: "Alice B.", weight: 71 })
    );
  });

  it("E. alice can create her own profile without a role", async () => {
    await assertSucceeds(setDoc(doc(alice(), "users", ALICE), PROFILE_FIELDS));
  });

  it("P. every field the onboarding and profile flows write is still accepted", async () => {
    // Written one at a time, the way the profile dialogs actually save.
    await assertSucceeds(setDoc(doc(alice(), "users", ALICE), PROFILE_FIELDS));

    for (const [field, value] of Object.entries(PROFILE_FIELDS)) {
      await assertSucceeds(updateDoc(doc(alice(), "users", ALICE), { [field]: value }));
    }
  });

  it("alice cannot write into bob's document", async () => {
    await seed(["users", BOB], PROFILE_FIELDS);

    await assertFails(updateDoc(doc(alice(), "users", BOB), { fullName: "hacked" }));
  });
});

describe("role escalation", () => {
  it("F. alice cannot create her profile with role: admin", async () => {
    await assertFails(
      setDoc(doc(alice(), "users", ALICE), { ...PROFILE_FIELDS, role: "admin" })
    );
  });

  it("F2. alice cannot create her profile with any role at all", async () => {
    // Not even the harmless-looking one — the client has no business setting it.
    await assertFails(
      setDoc(doc(alice(), "users", ALICE), { ...PROFILE_FIELDS, role: "user" })
    );
  });

  it("G. alice cannot add a role to a profile that has none", async () => {
    await seed(["users", ALICE], PROFILE_FIELDS);

    await assertFails(updateDoc(doc(alice(), "users", ALICE), { role: "admin" }));
  });

  it("H. owner cannot change role from user to admin", async () => {
    // The confirmed privilege-escalation path this PR closes.
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    await assertFails(updateDoc(doc(alice(), "users", ALICE), { role: "admin" }));
  });

  it("H2. a role change smuggled alongside a legitimate field is still refused", async () => {
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    await assertFails(
      updateDoc(doc(alice(), "users", ALICE), { fullName: "Alice B.", role: "admin" })
    );
  });

  it("H3. a merge write cannot escalate either", async () => {
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    await assertFails(
      setDoc(doc(alice(), "users", ALICE), { role: "admin" }, { merge: true })
    );
  });

  it("I. alice cannot delete an existing role via update", async () => {
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    // A full overwrite drops every field not listed, role included.
    await assertFails(setDoc(doc(alice(), "users", ALICE), PROFILE_FIELDS));
  });

  it("I2. alice may still update her profile when a role exists, as long as it is untouched", async () => {
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    await assertSucceeds(updateDoc(doc(alice(), "users", ALICE), { weight: 72 }));
  });

  it("I3. rewriting the same role value is accepted, since nothing changes", async () => {
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE), { role: "user", weight: 72 }, { merge: true })
    );
  });

  it("J. bob cannot mutate alice's role", async () => {
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "user" });

    await assertFails(updateDoc(doc(bob(), "users", ALICE), { role: "admin" }));
  });

  it("an admin cannot grant admin to somebody else from the client", async () => {
    // Being an admin in Firestore data is not a client-side authority.
    await seed(["users", ALICE], { ...PROFILE_FIELDS, role: "admin" });
    await seed(["users", BOB], PROFILE_FIELDS);

    await assertFails(updateDoc(doc(alice(), "users", BOB), { role: "admin" }));
  });

  it("the other authorization-sensitive spellings are refused too", async () => {
    await seed(["users", ALICE], PROFILE_FIELDS);

    for (const field of ["admin", "isAdmin", "roles", "permissions"]) {
      await assertFails(updateDoc(doc(alice(), "users", ALICE), { [field]: true }));
    }
  });
});

describe("user subcollections stay reachable", () => {
  it("K. alice retains write access to her own workout_logs", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1"), {
        planId: "plan1",
        weekKey: "Week 1",
        dayIndex: 0,
        completed: true,
        durationSec: 2700,
      })
    );
    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, "workout_logs", "log1")));
  });

  it("L. alice retains access to nested workout_set_logs", async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), "users", ALICE, "workout_logs", "log1", "workout_set_logs", "set1"),
        { setNumber: 1, repsCompleted: 10, weight: 60 }
      )
    );
    await assertSucceeds(
      getDocs(collection(alice(), "users", ALICE, "workout_logs", "log1", "workout_set_logs"))
    );
  });

  it("the other user-scoped collections still work", async () => {
    for (const sub of ["workout_plans", "nutrition_plans", "ai_logs"]) {
      await assertSucceeds(
        setDoc(doc(alice(), "users", ALICE, sub, "doc1"), { createdAt: "2026-08-27" })
      );
    }
  });

  it("M. bob cannot read or write alice's subcollections", async () => {
    await seed(["users", ALICE, "workout_logs", "log1"], { completed: true });

    await assertFails(getDoc(doc(bob(), "users", ALICE, "workout_logs", "log1")));
    await assertFails(
      setDoc(doc(bob(), "users", ALICE, "workout_logs", "log2"), { completed: true })
    );
    await assertFails(
      getDocs(collection(bob(), "users", ALICE, "workout_logs"))
    );
  });

  it("an unauthenticated client cannot reach a subcollection", async () => {
    await seed(["users", ALICE, "workout_logs", "log1"], { completed: true });

    await assertFails(getDoc(doc(anon(), "users", ALICE, "workout_logs", "log1")));
  });

  it("a subcollection document may carry a role field, which means nothing there", async () => {
    // The protection is scoped to the profile document; it must not leak into
    // unrelated data and start rejecting legitimate writes.
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1"), { role: "anything" })
    );
  });
});

describe("the shared exercise catalogue", () => {
  it("N. any signed-in user can read exercises", async () => {
    await seed(["exercises", "squat"], { name: "Kniebeuge" });

    await assertSucceeds(getDoc(doc(alice(), "exercises", "squat")));
    await assertSucceeds(getDocs(collection(bob(), "exercises")));
  });

  it("O. no client can write exercises", async () => {
    await seed(["exercises", "squat"], { name: "Kniebeuge" });

    await assertFails(setDoc(doc(alice(), "exercises", "new"), { name: "Neu" }));
    await assertFails(updateDoc(doc(alice(), "exercises", "squat"), { name: "Geändert" }));
    await assertFails(deleteDoc(doc(alice(), "exercises", "squat")));
  });

  it("an unauthenticated client cannot read exercises", async () => {
    await seed(["exercises", "squat"], { name: "Kniebeuge" });

    await assertFails(getDoc(doc(anon(), "exercises", "squat")));
  });
});

describe("nothing outside the declared paths is reachable", () => {
  it("refuses a collection the rules never mention", async () => {
    await assertFails(setDoc(doc(alice(), "coaching_results", "x"), { a: 1 }));
    await assertFails(getDoc(doc(alice(), "coaching_results", "x")));
  });

  it("refuses a cross-user listing of /users", async () => {
    await seed(["users", ALICE], PROFILE_FIELDS);
    await seed(["users", BOB], PROFILE_FIELDS);

    // Already true before this PR: a query whose results rules cannot prove
    // safe is rejected outright. The admin user list depends on it.
    await assertFails(getDocs(collection(alice(), "users")));
  });
});
