import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  runTransaction,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  NUTRITION_LEGACY_PLANS_COLLECTION,
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
} from "../shared/nutrition/collections";
import {
  ACCEPTED_TRANSITIONS,
  DATE,
  EXTRA_UUID,
  VALID_CREATES,
  customLunch,
  customSlotDoc,
  extraDoc,
  halfPortionLunch,
  intentId,
  nextDoc,
  plannedMealDoc,
  skipDoc,
  withRing,
  type EntryDoc,
} from "./nutritionEntryDocs";

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
    // nutrition_plans left this list when legacy Nutrition became read-only;
    // its contract is covered in the Nutrition blocks below.
    for (const sub of ["workout_plans", "ai_logs"]) {
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

describe("server-owned AI bookkeeping is invisible to clients", () => {
  /*
    These three decide whether a paid model call may happen, record what was
    spent, and stop one click becoming two charges. A client that could read or
    write any of them could spend money without limit or erase the evidence.

    The Admin SDK bypasses rules entirely, so Cloud Functions still use all
    three — that bypass is a documented property of the SDK, not something
    these tests can or should emulate.
  */
  const SERVER_COLLECTIONS = ["_ai_quota", "_ai_logs", "_ai_operations"] as const;

  it.each(SERVER_COLLECTIONS)("alice cannot read %s", async (collectionName) => {
    await seed([collectionName, `${ALICE}__plan_generation__2026-08`], { count: 1 });

    await assertFails(getDoc(doc(alice(), collectionName, `${ALICE}__plan_generation__2026-08`)));
  });

  it.each(SERVER_COLLECTIONS)("alice cannot write %s", async (collectionName) => {
    await assertFails(
      setDoc(doc(alice(), collectionName, `${ALICE}__plan_generation__2026-08`), { count: 0 })
    );
  });

  it.each(SERVER_COLLECTIONS)("alice cannot list %s", async (collectionName) => {
    await seed([collectionName, "any"], { count: 1 });

    await assertFails(getDocs(collection(alice(), collectionName)));
  });

  it.each(SERVER_COLLECTIONS)("bob cannot reach alice's %s entry", async (collectionName) => {
    await seed([collectionName, `${ALICE}__plan_generation__2026-08`], { count: 3 });

    await assertFails(getDoc(doc(bob(), collectionName, `${ALICE}__plan_generation__2026-08`)));
    await assertFails(
      setDoc(doc(bob(), collectionName, `${ALICE}__plan_generation__2026-08`), { count: 0 })
    );
  });

  it("alice cannot zero her own quota to buy more generations", async () => {
    await seed(["_ai_quota", `${ALICE}__plan_generation__2026-08`], { count: 3 });

    await assertFails(
      updateDoc(doc(alice(), "_ai_quota", `${ALICE}__plan_generation__2026-08`), { count: 0 })
    );
    await assertFails(deleteDoc(doc(alice(), "_ai_quota", `${ALICE}__plan_generation__2026-08`)));
  });

  it("an unauthenticated client cannot reach them either", async () => {
    await seed(["_ai_logs", "entry"], { status: "success" });

    await assertFails(getDoc(doc(anon(), "_ai_logs", "entry")));
  });

  it("does not deny the user-scoped collections by accident", async () => {
    // The deny blocks are top-level. A user's own data must be unaffected.
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE, "workout_plans", "plan1"), { content: {} })
    );
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE, "ai_logs", "legacy"), { note: "client-owned" })
    );
  });
});

/*
  Nutrition V2 is server-owned in this slice: the owner reads, no client
  writes. The generic owner wildcard under /users/{userId} used to grant read
  and write to any subcollection name, and rules OR their allows, so these
  tests check that the wildcard itself no longer reaches Nutrition — at the
  subcollection level and at the nested level alike.
*/
const V2_COLLECTIONS = Object.values(NUTRITION_V2_COLLECTIONS);
const V2_SERVER_OWNED = V2_COLLECTIONS.filter(
  (name) => name !== NUTRITION_V2_COLLECTIONS.entries
);

describe("Nutrition V2 is owner-readable", () => {
  it("covers exactly the six canonical collections", () => {
    expect([...V2_COLLECTIONS].sort()).toEqual([
      "nutrition_v2_entries",
      "nutrition_v2_generations",
      "nutrition_v2_plans",
      "nutrition_v2_slots",
      "nutrition_v2_state",
      "nutrition_v2_targets",
    ]);
  });

  it.each(V2_COLLECTIONS)("alice can read her own %s", async (name) => {
    await seed(["users", ALICE, name, "doc1"], { v: 1 });

    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, name, "doc1")));
    await assertSucceeds(getDocs(collection(alice(), "users", ALICE, name)));
  });

  it.each(V2_COLLECTIONS)("bob cannot read alice's %s", async (name) => {
    await seed(["users", ALICE, name, "doc1"], { v: 1 });

    await assertFails(getDoc(doc(bob(), "users", ALICE, name, "doc1")));
    await assertFails(getDocs(collection(bob(), "users", ALICE, name)));
  });

  it.each(V2_COLLECTIONS)("an unauthenticated client cannot read %s", async (name) => {
    await seed(["users", ALICE, name, "doc1"], { v: 1 });

    await assertFails(getDoc(doc(anon(), "users", ALICE, name, "doc1")));
    await assertFails(getDocs(collection(anon(), "users", ALICE, name)));
  });
});

describe("the Nutrition V2 client reads (NUT-05)", () => {
  // The exact read shapes src/lib/nutrition/v2/firestoreReads.ts issues.
  const V2 = NUTRITION_V2_COLLECTIONS;
  const slotsOfPlan = (db: ReturnType<typeof alice>) =>
    query(collection(db, "users", ALICE, V2.slots), where("planId", "==", "plan-1"));
  const entriesOnDate = (db: ReturnType<typeof alice>) =>
    query(collection(db, "users", ALICE, V2.entries), where("date", "==", "2026-09-25"));
  const entriesInRange = (db: ReturnType<typeof alice>) =>
    query(
      collection(db, "users", ALICE, V2.entries),
      where("date", ">=", "2026-09-23"),
      where("date", "<=", "2026-09-29")
    );

  beforeEach(async () => {
    await seed(["users", ALICE, V2.state, NUTRITION_V2_STATE_DOC_ID], { activePlanId: "plan-1" });
    await seed(["users", ALICE, V2.plans, "plan-1"], { planId: "plan-1" });
    await seed(["users", ALICE, V2.targets, "target-1"], { targetVersionId: "target-1" });
    await seed(["users", ALICE, V2.slots, "plan-1__2026-09-25__lunch"], { planId: "plan-1", date: "2026-09-25" });
    await seed(["users", ALICE, V2.entries, "slot:2026-09-25:lunch"], { date: "2026-09-25" });
  });

  it("alice can run every one against her own account", async () => {
    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, V2.state, NUTRITION_V2_STATE_DOC_ID)));
    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, V2.plans, "plan-1")));
    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, V2.targets, "target-1")));
    // A pointer to a missing document is readable as "absent"; the client treats it as an error.
    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, V2.plans, "plan-404")));

    const slots = await assertSucceeds(getDocs(slotsOfPlan(alice())));
    expect(slots.docs.map((d) => d.id)).toEqual(["plan-1__2026-09-25__lunch"]);
    const onDate = await assertSucceeds(getDocs(entriesOnDate(alice())));
    expect(onDate.docs.map((d) => d.id)).toEqual(["slot:2026-09-25:lunch"]);
    const inRange = await assertSucceeds(getDocs(entriesInRange(alice())));
    expect(inRange.docs.map((d) => d.id)).toEqual(["slot:2026-09-25:lunch"]);
  });

  it("bob and an unauthenticated client can run none of them against alice", async () => {
    for (const db of [bob(), anon()]) {
      await assertFails(getDoc(doc(db, "users", ALICE, V2.state, NUTRITION_V2_STATE_DOC_ID)));
      await assertFails(getDoc(doc(db, "users", ALICE, V2.plans, "plan-1")));
      await assertFails(getDoc(doc(db, "users", ALICE, V2.targets, "target-1")));
      await assertFails(getDocs(slotsOfPlan(db)));
      await assertFails(getDocs(entriesOnDate(db)));
      await assertFails(getDocs(entriesInRange(db)));
    }
  });
});

describe("Nutrition V2 refuses every client write but a valid entry", () => {
  const expectNoOwnerWrites = async (name: string) => {
    await seed(["users", ALICE, name, "existing"], { v: 1 });

    await assertFails(setDoc(doc(alice(), "users", ALICE, name, "new"), { v: 1 }));
    await assertFails(updateDoc(doc(alice(), "users", ALICE, name, "existing"), { v: 2 }));
    await assertFails(
      setDoc(doc(alice(), "users", ALICE, name, "existing"), { v: 2 }, { merge: true })
    );
    await assertFails(deleteDoc(doc(alice(), "users", ALICE, name, "existing")));
  };

  it.each(V2_SERVER_OWNED)("alice cannot create, update or delete her %s", expectNoOwnerWrites);

  it("alice cannot write an arbitrary document to her nutrition_v2_entries, or delete one", async () => {
    // Entries accept exactly the validated recorded-entry write (NUT-06,
    // covered below); a document of any other shape is refused like the rest.
    await expectNoOwnerWrites(NUTRITION_V2_COLLECTIONS.entries);
  });

  it.each(V2_COLLECTIONS)("bob cannot write alice's %s", async (name) => {
    await assertFails(setDoc(doc(bob(), "users", ALICE, name, "doc1"), { v: 1 }));
  });

  it.each(V2_COLLECTIONS)("an unauthenticated client cannot write %s", async (name) => {
    await assertFails(setDoc(doc(anon(), "users", ALICE, name, "doc1"), { v: 1 }));
  });
});

describe("the owner wildcard no longer reaches Nutrition", () => {
  it("a future nutrition_v2_* collection is neither readable nor writable", async () => {
    // Protected by the namespace, not by a list of today's names.
    await seed(["users", ALICE, "nutrition_v2_future", "doc1"], { v: 1 });

    await assertFails(getDoc(doc(alice(), "users", ALICE, "nutrition_v2_future", "doc1")));
    await assertFails(
      setDoc(doc(alice(), "users", ALICE, "nutrition_v2_future", "doc2"), { v: 1 })
    );
  });

  it.each(V2_COLLECTIONS)("nothing nested under %s is writable", async (name) => {
    await seed(["users", ALICE, name, "doc1", "child", "c1"], { v: 1 });

    await assertFails(
      setDoc(doc(alice(), "users", ALICE, name, "doc1", "child", "c2"), { v: 1 })
    );
    await assertFails(
      updateDoc(doc(alice(), "users", ALICE, name, "doc1", "child", "c1"), { v: 2 })
    );
    await assertFails(deleteDoc(doc(alice(), "users", ALICE, name, "doc1", "child", "c1")));
    await assertFails(getDoc(doc(alice(), "users", ALICE, name, "doc1", "child", "c1")));
  });

  it("nothing nested under legacy nutrition_plans is writable", async () => {
    await assertFails(
      setDoc(doc(alice(), "users", ALICE, "nutrition_plans", "p1", "child", "c1"), { v: 1 })
    );
  });

  it.each(V2_COLLECTIONS)(
    "%s is not writable as a nested collection under an unrelated parent",
    async (name) => {
      // The nested wildcard level: e.g. workout_logs/{id}/nutrition_v2_entries.
      await assertFails(
        setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1", name, "x"), { v: 1 })
      );
      await assertFails(
        setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1", "nutrition_v2_future", "x"), {
          v: 1,
        })
      );
    }
  );

  it("unrelated user subcollections keep their read/write contract", async () => {
    // Includes names that merely resemble the namespace without starting it.
    for (const sub of [
      "workout_plans",
      "workout_logs",
      "ai_logs",
      "nutrition_notes",
      "my_nutrition_v2_things",
    ]) {
      await assertSucceeds(setDoc(doc(alice(), "users", ALICE, sub, "d1"), { v: 1 }));
      await assertSucceeds(updateDoc(doc(alice(), "users", ALICE, sub, "d1"), { v: 2 }));
      await assertSucceeds(getDoc(doc(alice(), "users", ALICE, sub, "d1")));
      await assertSucceeds(deleteDoc(doc(alice(), "users", ALICE, sub, "d1")));
    }
  });

  it("nested workout_set_logs keep their read/write/delete contract", async () => {
    const path = ["users", ALICE, "workout_logs", "log1", "workout_set_logs", "set1"] as const;

    await assertSucceeds(setDoc(doc(alice(), ...path), { setNumber: 1, repsCompleted: 10 }));
    await assertSucceeds(updateDoc(doc(alice(), ...path), { repsCompleted: 12 }));
    await assertSucceeds(getDoc(doc(alice(), ...path)));
    await assertSucceeds(deleteDoc(doc(alice(), ...path)));
  });

  it("workout_plans keep their full owner contract, and bob stays out", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE, "workout_plans", "plan1"), { content: {} })
    );
    await assertSucceeds(
      updateDoc(doc(alice(), "users", ALICE, "workout_plans", "plan1"), { content: { a: 1 } })
    );
    await assertSucceeds(deleteDoc(doc(alice(), "users", ALICE, "workout_plans", "plan1")));

    await seed(["users", ALICE, "workout_plans", "plan2"], { content: {} });
    await assertFails(getDoc(doc(bob(), "users", ALICE, "workout_plans", "plan2")));
    await assertFails(deleteDoc(doc(bob(), "users", ALICE, "workout_plans", "plan2")));
  });
});

describe("legacy nutrition_plans is client read-only", () => {
  const LEGACY = NUTRITION_LEGACY_PLANS_COLLECTION;

  it("alice can read her own plans, including the latest-plan query", async () => {
    await seed(["users", ALICE, LEGACY, "p1"], { content: {}, createdAt: new Date() });

    await assertSucceeds(getDoc(doc(alice(), "users", ALICE, LEGACY, "p1")));
    await assertSucceeds(getDocs(collection(alice(), "users", ALICE, LEGACY)));
  });

  it("alice cannot create a plan", async () => {
    await assertFails(setDoc(doc(alice(), "users", ALICE, LEGACY, "p1"), { content: {} }));
  });

  it("alice cannot update a plan", async () => {
    await seed(["users", ALICE, LEGACY, "p1"], { content: {} });

    await assertFails(updateDoc(doc(alice(), "users", ALICE, LEGACY, "p1"), { content: { a: 1 } }));
    await assertFails(
      setDoc(doc(alice(), "users", ALICE, LEGACY, "p1"), { content: { a: 1 } }, { merge: true })
    );
  });

  it("alice cannot delete a plan", async () => {
    // The AdminPanel's direct client delete of a nutrition plan is refused
    // from here on, by design; deletion belongs to a server-authorized path.
    await seed(["users", ALICE, LEGACY, "p1"], { content: {} });

    await assertFails(deleteDoc(doc(alice(), "users", ALICE, LEGACY, "p1")));
  });

  it("bob cannot read alice's plans", async () => {
    await seed(["users", ALICE, LEGACY, "p1"], { content: {} });

    await assertFails(getDoc(doc(bob(), "users", ALICE, LEGACY, "p1")));
    await assertFails(getDocs(collection(bob(), "users", ALICE, LEGACY)));
  });

  it("an unauthenticated client cannot read them", async () => {
    await seed(["users", ALICE, LEGACY, "p1"], { content: {} });

    await assertFails(getDoc(doc(anon(), "users", ALICE, LEGACY, "p1")));
  });
});

/*
  NUT-06. Recorded entries are the one Nutrition V2 collection a client may
  write: an adult owner creates and updates them through a compare-and-set
  write, and nobody deletes them. Every other V2 collection and legacy
  Nutrition stay read-only. The documents come from ./nutritionEntryDocs,
  which the client suite checks against the canonical schema and planner.
*/
describe("Nutrition V2 recorded entries (NUT-06)", () => {
  const ENTRIES = NUTRITION_V2_COLLECTIONS.entries;
  const entryRef = (db: Firestore, id: string, uid = ALICE) => doc(db, "users", uid, ENTRIES, id);
  const create = (db: Firestore, entry: EntryDoc, id = entry.entryId, uid = ALICE) =>
    setDoc(entryRef(db, id, uid), entry);
  const seedEntry = (entry: EntryDoc, uid = ALICE) => seed(["users", uid, ENTRIES, entry.entryId], entry);
  const seedProfile = (uid: string, profile: Record<string, unknown>) => seed(["users", uid], profile);

  beforeEach(async () => {
    await seedProfile(ALICE, PROFILE_FIELDS);
    await seedProfile(BOB, PROFILE_FIELDS);
  });

  describe("account and adult gate", () => {
    it("1. the adult owner can create a valid entry and read it back", async () => {
      await assertSucceeds(create(alice(), plannedMealDoc()));
      const snap = await assertSucceeds(getDoc(entryRef(alice(), plannedMealDoc().entryId)));
      expect(snap.data()).toEqual(plannedMealDoc());
    });

    it("2. another signed-in adult cannot create or update it", async () => {
      await assertFails(create(bob(), plannedMealDoc()));

      await seedEntry(plannedMealDoc());
      await assertFails(
        setDoc(entryRef(bob(), plannedMealDoc().entryId), nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }))
      );
      await assertFails(deleteDoc(entryRef(bob(), plannedMealDoc().entryId)));
    });

    it("3. a signed-out client cannot write", async () => {
      await assertFails(create(anon(), plannedMealDoc()));

      await seedEntry(plannedMealDoc());
      await assertFails(
        setDoc(entryRef(anon(), plannedMealDoc().entryId), nextDoc(plannedMealDoc(), intentId(2), { status: "removed" }))
      );
    });

    it("4. an owner aged 17 cannot create or update", async () => {
      await seedProfile(ALICE, { ...PROFILE_FIELDS, age: 17 });
      await assertFails(create(alice(), plannedMealDoc()));

      await seedEntry(extraDoc());
      await assertFails(setDoc(entryRef(alice(), extraDoc().entryId), nextDoc(extraDoc(), intentId(2), { status: "removed" })));
    });

    it("an owner aged exactly 18 can write", async () => {
      await seedProfile(ALICE, { ...PROFILE_FIELDS, age: 18 });
      await assertSucceeds(create(alice(), plannedMealDoc()));
    });

    it("5. an owner without an age, or without a profile, cannot write", async () => {
      const { age: _age, ...noAge } = PROFILE_FIELDS;
      await seedProfile(ALICE, noAge);
      await assertFails(create(alice(), plannedMealDoc()));

      await seedProfile(ALICE, { ...PROFILE_FIELDS, age: null });
      await assertFails(create(alice(), plannedMealDoc()));

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await deleteDoc(doc(context.firestore(), "users", ALICE));
      });
      await assertFails(create(alice(), plannedMealDoc()));
    });

    it.each([
      ["a string", "30"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["a map", { years: 30 }],
      ["a boolean", true],
    ])("6. an owner whose age is %s cannot write", async (_label, age) => {
      await seedProfile(ALICE, { ...PROFILE_FIELDS, age });
      await assertFails(create(alice(), plannedMealDoc()));
    });

    it("the age gate does not block reading", async () => {
      await seedEntry(plannedMealDoc());
      await seedProfile(ALICE, { ...PROFILE_FIELDS, age: 17 });
      await assertSucceeds(getDoc(entryRef(alice(), plannedMealDoc().entryId)));
    });

    it("under-18 owners keep their Training writes", async () => {
      await seedProfile(ALICE, { ...PROFILE_FIELDS, age: 16 });
      await assertSucceeds(setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1"), { completed: true }));
      await assertSucceeds(updateDoc(doc(alice(), "users", ALICE), { weight: 60 }));
    });
  });

  describe("create", () => {
    it.each(VALID_CREATES)("7–10. accepts a valid %s entry", async (_label, make) => {
      await assertSucceeds(create(alice(), make()));
    });

    it("keeps unknown macros as null", async () => {
      await assertSucceeds(create(alice(), customSlotDoc()));
      const snap = await getDoc(entryRef(alice(), customSlotDoc().entryId));
      expect(snap.data()?.nutritionEstimate).toEqual({ kcal: 950, proteinG: null, carbsG: 110, fatG: null });
    });

    it.each([0, 2, -1, 1.5])("11. refuses a first revision of %s", async (revision) => {
      await assertFails(create(alice(), { ...plannedMealDoc(), revision }));
    });

    it("12. refuses an entry that starts as a tombstone", async () => {
      await assertFails(create(alice(), { ...plannedMealDoc(), status: "removed" }));
      await assertFails(create(alice(), { ...plannedMealDoc(), status: "deleted" }));
    });

    it("13. refuses a document stored under an id that is not its entryId", async () => {
      await assertFails(create(alice(), plannedMealDoc(), `slot:${DATE}:dinner`));
      await assertFails(create(alice(), plannedMealDoc(), "lunch"));
      await assertFails(create(alice(), extraDoc(), `extra:${intentId(9)}`));
    });

    it("14. refuses a slot entry whose id is not slot:{date}:{slotId}", async () => {
      for (const entryId of [`slot:2026-09-25:lunch`, `slot:${DATE}:dinner`, `slot:${DATE}:Lunch`, `${DATE}:lunch`]) {
        await assertFails(create(alice(), { ...plannedMealDoc(), entryId }));
      }
      await assertFails(create(alice(), { ...plannedMealDoc(), slotId: "snack" , entryId: `slot:${DATE}:snack` }));
      await assertFails(create(alice(), { ...plannedMealDoc(), slotId: null }));
    });

    it("15. refuses a malformed extra id or extra identity", async () => {
      for (const entryId of ["extra:not-a-uuid", `extra:${EXTRA_UUID.toUpperCase()}`, `extra:${EXTRA_UUID}x`, EXTRA_UUID]) {
        await assertFails(create(alice(), { ...extraDoc(), entryId }));
      }
      await assertFails(create(alice(), { ...extraDoc(), slotId: "lunch" }));
      // Only a custom recording can be an extra.
      const { name: _name, ...skipShape } = { ...skipDoc(), entryId: `extra:${EXTRA_UUID}`, kind: "extra", slotId: null };
      await assertFails(create(alice(), skipShape as EntryDoc));
    });

    it("16. refuses an unknown field", async () => {
      await assertFails(create(alice(), { ...extraDoc(), note: "x" }));
      await assertFails(create(alice(), { ...plannedMealDoc(), actualCalories: 918 }));
      await assertFails(create(alice(), { ...extraDoc(), nutritionEstimate: { ...extraDoc().nutritionEstimate as object, fiberG: 3 } }));
      await assertFails(create(alice(), { ...skipDoc(), uid: ALICE }));
    });

    it("refuses a missing field", async () => {
      for (const field of ["schemaVersion", "date", "slotId", "estimateBasis", "revision", "status", "appliedIntentIds"]) {
        const { [field]: _omitted, ...rest } = plannedMealDoc();
        await assertFails(create(alice(), rest as EntryDoc));
      }
      const { planId: _planId, ...noPlan } = plannedMealDoc();
      await assertFails(create(alice(), noPlan as EntryDoc));
    });

    it.each([
      ["negative kcal", { kcal: -1, proteinG: 60, carbsG: 120, fatG: 30 }],
      ["NaN protein", { kcal: 900, proteinG: Number.NaN, carbsG: 120, fatG: 30 }],
      ["infinite carbs", { kcal: 900, proteinG: 60, carbsG: Number.POSITIVE_INFINITY, fatG: 30 }],
      ["a string", { kcal: "900", proteinG: 60, carbsG: 120, fatG: 30 }],
      ["an unknown planned macro", { kcal: 900, proteinG: null, carbsG: 120, fatG: 30 }],
      ["a missing macro", { kcal: 900, proteinG: 60, carbsG: 120 }],
    ])("17. refuses a planned-meal estimate with %s", async (_label, nutritionEstimate) => {
      await assertFails(create(alice(), { ...plannedMealDoc(), nutritionEstimate }));
    });

    it("refuses a portion that is not a finite number above zero, but accepts any other", async () => {
      for (const portion of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
        await assertFails(create(alice(), { ...plannedMealDoc(), portion }));
      }
      await assertSucceeds(create(alice(), { ...plannedMealDoc(), portion: 1.3 }));
    });

    it("refuses a negative or non-finite custom value", async () => {
      await assertFails(create(alice(), { ...extraDoc(), nutritionEstimate: { kcal: 80, proteinG: -1, carbsG: null, fatG: null } }));
      await assertFails(create(alice(), { ...extraDoc(), nutritionEstimate: { kcal: Number.NaN, proteinG: null, carbsG: null, fatG: null } }));
    });

    it("18. refuses a custom recording without stated kcal", async () => {
      await assertFails(create(alice(), { ...extraDoc(), nutritionEstimate: { kcal: null, proteinG: 1, carbsG: 1, fatG: 1 } }));
      await assertFails(create(alice(), { ...extraDoc(), estimateBasis: "none", nutritionEstimate: null }));
      await assertFails(create(alice(), { ...customSlotDoc(), estimateBasis: "userStated", nutritionEstimate: null }));
    });

    it("refuses an empty name, a skip with an estimate, and a wrong basis", async () => {
      await assertFails(create(alice(), { ...extraDoc(), name: "   " }));
      await assertFails(create(alice(), { ...skipDoc(), nutritionEstimate: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } }));
      await assertFails(create(alice(), { ...plannedMealDoc(), estimateBasis: "userStated" }));
      await assertFails(create(alice(), { ...plannedMealDoc(), planId: "plan__1" }));
    });

    it("refuses a date that is not a real calendar day", async () => {
      for (const date of ["2026-02-30", "2026-13-01", "26-09-2026", "2026-9-26"]) {
        await assertFails(create(alice(), { ...extraDoc(), date }));
      }
      await assertSucceeds(create(alice(), { ...extraDoc(), date: "2028-02-29" }));
    });

    it("sets no date window: a past date is accepted (the client alone refuses the future)", async () => {
      await assertSucceeds(create(alice(), { ...extraDoc(), date: "2024-01-15" }));
    });

    it("refuses a schemaVersion other than 2", async () => {
      await assertFails(create(alice(), { ...plannedMealDoc(), schemaVersion: 1 }));
      await assertFails(create(alice(), { ...plannedMealDoc(), schemaVersion: "2" }));
    });

    it.each([
      ["no intent id", []],
      ["two intent ids", [intentId(1), intentId(2)]],
      ["a device id", ["device-1"]],
      ["an upper-case UUID", [EXTRA_UUID.toUpperCase()]],
      ["a number", [42]],
      ["a bare string", intentId(1)],
    ])("needs exactly one applied intent id, a lower-case UUID: refuses %s", async (_label, appliedIntentIds) => {
      await assertFails(create(alice(), { ...plannedMealDoc(), appliedIntentIds: appliedIntentIds as string[] }));
    });
  });

  describe("update (compare-and-set)", () => {
    const LUNCH = plannedMealDoc().entryId;
    const write = (next: EntryDoc, db = alice()) => setDoc(entryRef(db, next.entryId), next);

    it.each(ACCEPTED_TRANSITIONS.filter((transition) => transition.prev !== null).map((t) => [t.name, t] as const))(
      "accepts: %s",
      async (_name, transition) => {
        await seedEntry(transition.prev as EntryDoc);
        await assertSucceeds(write(transition.next));
      }
    );

    it("19. accepts exactly revision + 1", async () => {
      await seedEntry(plannedMealDoc());
      await assertSucceeds(write(nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() })));
    });

    it("20. refuses the same revision", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), revision: 1 }));
    });

    it("21. refuses revision + 2", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), revision: 3 }));
    });

    it("22. refuses a decrement", async () => {
      const prev = withRing(plannedMealDoc(), 5);
      await seedEntry(prev);
      await assertFails(write({ ...nextDoc(prev, intentId(2), { desired: halfPortionLunch() }), revision: 4 }));
    });

    it("23. refuses an entryId change", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(
        setDoc(entryRef(alice(), LUNCH), {
          ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }),
          entryId: `slot:${DATE}:dinner`,
        })
      );
    });

    it("24. refuses a date change", async () => {
      await seedEntry(extraDoc());
      await assertFails(write({ ...nextDoc(extraDoc(), intentId(2), { desired: extraDoc() }), date: "2026-09-25" }));

      await seedEntry(plannedMealDoc());
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), date: "2026-09-25" }));
    });

    it("25. refuses a slotId change", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), slotId: "dinner" }));
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), slotId: null }));
    });

    it("26. refuses a kind change", async () => {
      await seedEntry(extraDoc());
      await assertFails(write({ ...nextDoc(extraDoc(), intentId(2), { desired: extraDoc() }), kind: "slot", slotId: "lunch" }));
      await seedEntry(customLunch());
      await assertFails(write({ ...nextDoc(customLunch(), intentId(2), { desired: customLunch() }), kind: "extra", slotId: null }));
    });

    it("27. refuses a schemaVersion change", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), schemaVersion: 3 }));
    });

    it("28. accepts active → removed, keeping the snapshot", async () => {
      await seedEntry(plannedMealDoc());
      const tombstone = nextDoc(plannedMealDoc(), intentId(2), { status: "removed" });
      await assertSucceeds(write(tombstone));
      const snap = await getDoc(entryRef(alice(), LUNCH));
      expect(snap.data()).toEqual(tombstone);
      expect(snap.data()?.nutritionEstimate).toEqual(plannedMealDoc().nutritionEstimate);
    });

    it("refuses a removal that rewrites the snapshot", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(write({ ...nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() }), status: "removed" }));
    });

    it("29. accepts removed → active when the result is valid", async () => {
      const tombstone = nextDoc(plannedMealDoc(), intentId(2), { status: "removed" });
      await seedEntry(tombstone);
      await assertSucceeds(write(nextDoc(tombstone, intentId(3), { desired: plannedMealDoc() })));
    });

    it("refuses removed → removed, and an invalid re-recording", async () => {
      const tombstone = nextDoc(plannedMealDoc(), intentId(2), { status: "removed" });
      await seedEntry(tombstone);
      await assertFails(write(nextDoc(tombstone, intentId(3), { status: "removed" })));
      await assertFails(write({ ...nextDoc(tombstone, intentId(3), { desired: customLunch() }), nutritionEstimate: null }));
    });

    it("30. refuses a hard delete of an active entry or a tombstone", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(deleteDoc(entryRef(alice(), LUNCH)));

      await seedEntry(nextDoc(extraDoc(), intentId(2), { status: "removed" }));
      await assertFails(deleteDoc(entryRef(alice(), extraDoc().entryId)));
    });

    it("refuses a partial update that bypasses the full document rules", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(updateDoc(entryRef(alice(), LUNCH), { portion: 2 }));
      await assertFails(updateDoc(entryRef(alice(), LUNCH), { revision: 2 }));
    });

    it("refuses an update whose ring does not advance by one fresh intent", async () => {
      await seedEntry(plannedMealDoc());
      const next = nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() });

      // Nothing appended.
      await assertFails(write({ ...next, appliedIntentIds: [intentId(1)] }));
      // An already-applied id appended again.
      await assertFails(write({ ...next, appliedIntentIds: [intentId(1), intentId(1)] }));
      // Two appended at once.
      await assertFails(write({ ...next, appliedIntentIds: [intentId(1), intentId(2), intentId(3)] }));
      // History rewritten.
      await assertFails(write({ ...next, appliedIntentIds: [intentId(9), intentId(2)] }));
      // Not an intent id.
      await assertFails(write({ ...next, appliedIntentIds: [intentId(1), "device-1"] }));
    });

    it("refuses a ring over 20, or one that evicts anything but the oldest", async () => {
      const prev = withRing(plannedMealDoc(), 20);
      await seedEntry(prev);
      const next = nextDoc(prev, intentId(1), { desired: halfPortionLunch() });

      await assertFails(write({ ...next, appliedIntentIds: [...prev.appliedIntentIds, intentId(1)] }));
      await assertFails(write({ ...next, appliedIntentIds: [...prev.appliedIntentIds.slice(0, 19), intentId(1)] }));
      await assertSucceeds(write(next));
      expect((await getDoc(entryRef(alice(), LUNCH))).data()?.appliedIntentIds).toEqual([
        ...prev.appliedIntentIds.slice(1),
        intentId(1),
      ]);
    });

    it("refuses an update by an owner who is no longer an adult", async () => {
      await seedEntry(plannedMealDoc());
      await seedProfile(ALICE, { ...PROFILE_FIELDS, age: 17 });
      await assertFails(write(nextDoc(plannedMealDoc(), intentId(2), { status: "removed" })));
    });
  });

  describe("through a transaction, as the client writes", () => {
    const LUNCH = plannedMealDoc().entryId;

    /** Read → check the revision the person saw → set the next document: the client's CAS shape. */
    const casWrite = (db: Firestore, expectedRevision: number, next: EntryDoc, uid = ALICE) =>
      runTransaction(db, async (transaction) => {
        const ref = entryRef(db, next.entryId, uid);
        const snap = await transaction.get(ref);
        const current = snap.exists() ? (snap.data() as EntryDoc) : null;
        if ((current?.revision ?? 0) !== expectedRevision) throw new Error("conflict");
        transaction.set(ref, next);
      });

    it("creates, corrects and tombstones an entry", async () => {
      await assertSucceeds(casWrite(alice(), 0, plannedMealDoc()));
      const corrected = nextDoc(plannedMealDoc(), intentId(2), { desired: halfPortionLunch() });
      await assertSucceeds(casWrite(alice(), 1, corrected));
      const removed = nextDoc(corrected, intentId(3), { status: "removed" });
      await assertSucceeds(casWrite(alice(), 2, removed));

      expect((await getDoc(entryRef(alice(), LUNCH))).data()).toEqual(removed);
    });

    it("another account's transaction is refused", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(casWrite(bob(), 1, nextDoc(plannedMealDoc(), intentId(2), { status: "removed" })));
      await assertFails(casWrite(bob(), 0, extraDoc()));
      expect((await getDoc(entryRef(alice(), LUNCH))).data()).toEqual(plannedMealDoc());
    });

    it("a transaction cannot delete an entry", async () => {
      await seedEntry(plannedMealDoc());
      const db = alice();
      await assertFails(
        runTransaction(db, async (transaction) => {
          const ref = entryRef(db, LUNCH);
          await transaction.get(ref);
          transaction.delete(ref);
        })
      );
    });
  });

  describe("the rest of Nutrition stays client read-only", () => {
    it.each(V2_SERVER_OWNED)("31–35. an adult owner cannot write a valid entry-shaped document to %s", async (name) => {
      await assertFails(setDoc(doc(alice(), "users", ALICE, name, plannedMealDoc().entryId), plannedMealDoc()));
      await assertFails(setDoc(doc(alice(), "users", ALICE, name, "current"), { schemaVersion: 2, activePlanId: null }));
    });

    it("36. legacy nutrition_plans stays read-only for an adult owner", async () => {
      await assertFails(setDoc(doc(alice(), "users", ALICE, NUTRITION_LEGACY_PLANS_COLLECTION, "p1"), { content: {} }));
    });

    it("nothing nested under an entry is writable", async () => {
      await seedEntry(plannedMealDoc());
      await assertFails(setDoc(doc(alice(), "users", ALICE, NUTRITION_V2_COLLECTIONS.entries, plannedMealDoc().entryId, "child", "c1"), plannedMealDoc()));
    });

    it("37. unrelated owner-scoped Training writes still work", async () => {
      await assertSucceeds(setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1"), { completed: true }));
      await assertSucceeds(
        setDoc(doc(alice(), "users", ALICE, "workout_logs", "log1", "workout_set_logs", "set1"), { setNumber: 1 })
      );
      await assertSucceeds(setDoc(doc(alice(), "users", ALICE, "workout_plans", "plan1"), { content: {} }));
      await assertSucceeds(deleteDoc(doc(alice(), "users", ALICE, "workout_plans", "plan1")));
    });
  });
});
