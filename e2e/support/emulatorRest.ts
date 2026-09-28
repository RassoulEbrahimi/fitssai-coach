import { E2E_FUNCTIONS_REGION, type LocalEmulatorEnv } from "./emulatorEnv";

/**
 * The emulator REST calls the harness makes. Every URL is built from a
 * `LocalEmulatorEnv` (checked by `requireLocalEmulatorEnv`) and checked again
 * here, so nothing in this module can address a real Google endpoint.
 * No Firebase SDK, so the Playwright tests can use it directly.
 */

const emulatorUrl = (env: LocalEmulatorEnv, url: string): string => {
  if (![env.authUrl, env.firestoreUrl, env.functionsUrl].some((origin) => url.startsWith(`${origin}/`))) {
    throw new Error(`${url} is not an emulator URL`);
  }
  return url;
};

export const emulatorRequest = async (
  env: LocalEmulatorEnv,
  url: string,
  init: RequestInit,
  what: string
): Promise<Record<string, unknown>> => {
  const checked = emulatorUrl(env, url);
  let response: Response;
  try {
    response = await fetch(checked, init);
  } catch {
    throw new Error(`${what}: the emulator at ${new URL(url).host} is not reachable. Start it with npm run e2e:emulators.`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
};

/** The emulators' admin token: accepted by the Auth and Firestore emulators only. */
export const OWNER_HEADERS = { authorization: "Bearer owner", "content-type": "application/json" };

/** Wipe every account and every document of the demo project in the emulators. */
export const resetEmulators = async (env: LocalEmulatorEnv): Promise<void> => {
  await emulatorRequest(env, `${env.authUrl}/emulator/v1/projects/${env.projectId}/accounts`, { method: "DELETE" }, "Auth reset");
  await emulatorRequest(
    env,
    `${env.firestoreUrl}/emulator/v1/projects/${env.projectId}/databases/(default)/documents`,
    { method: "DELETE" },
    "Firestore reset"
  );
};

/** Create an email/password account with a fixed uid in the Auth emulator. */
export const createEmulatorAccount = (env: LocalEmulatorEnv, uid: string, email: string, password: string) =>
  emulatorRequest(
    env,
    `${env.authUrl}/identitytoolkit.googleapis.com/v1/projects/${env.projectId}/accounts`,
    { method: "POST", headers: OWNER_HEADERS, body: JSON.stringify({ localId: uid, email, password, emailVerified: true }) },
    `Create ${email}`
  );

/** Sign in against the Auth emulator; the ID token of `uid`. */
export const emulatorIdToken = async (env: LocalEmulatorEnv, uid: string, email: string, password: string): Promise<string> => {
  const result = await emulatorRequest(
    env,
    // The emulator accepts any API key; this one is a placeholder.
    `${env.authUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-fitssai-e2e`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
    `Sign in ${email}`
  );
  if (result.localId !== uid || typeof result.idToken !== "string") throw new Error(`Sign in ${email}: unexpected account`);
  return result.idToken;
};

/** POST a callable on the Functions emulator as the token's account, the way the web SDK does. */
export const callEmulatorCallable = async (
  env: LocalEmulatorEnv,
  name: string,
  idToken: string,
  data: unknown
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const url = emulatorUrl(env, `${env.functionsUrl}/${env.projectId}/${E2E_FUNCTIONS_REGION}/${name}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
  } catch {
    throw new Error(`${name}: the Functions emulator at ${new URL(url).host} is not reachable.`);
  }
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
};

/** The ids of the documents in a collection, read with the emulator's admin token. */
export const listEmulatorDocumentIds = async (env: LocalEmulatorEnv, collectionPath: string): Promise<string[]> => {
  const result = await emulatorRequest(
    env,
    `${env.firestoreUrl}/v1/projects/${env.projectId}/databases/(default)/documents/${collectionPath}?pageSize=300`,
    { headers: OWNER_HEADERS },
    `List ${collectionPath}`
  );
  const documents = (result.documents ?? []) as { name: string }[];
  return documents.map((document) => document.name.split("/").pop() ?? "");
};

/** One document's raw REST fields, or null when it does not exist. */
export const getEmulatorDocument = async (
  env: LocalEmulatorEnv,
  documentPath: string
): Promise<Record<string, unknown> | null> => {
  const url = emulatorUrl(env, `${env.firestoreUrl}/v1/projects/${env.projectId}/databases/(default)/documents/${documentPath}`);
  const response = await fetch(url, { headers: OWNER_HEADERS });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Get ${documentPath} failed with HTTP ${response.status}`);
  return ((await response.json()) as { fields?: Record<string, unknown> }).fields ?? {};
};

/** A plain JSON value in the Firestore REST encoding (integers stay integers). */
export const toFirestoreValue = (value: unknown): Record<string, unknown> => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])) } };
  }
  throw new Error(`cannot encode ${typeof value}`);
};

/**
 * Create a document as the account whose ID token is given — the security
 * rules decide, exactly as for the web SDK. Answers the HTTP status and body.
 */
export const createEmulatorDocumentAs = async (
  env: LocalEmulatorEnv,
  idToken: string,
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const url = emulatorUrl(
    env,
    `${env.firestoreUrl}/v1/projects/${env.projectId}/databases/(default)/documents/${collectionPath}?documentId=${encodeURIComponent(documentId)}`
  );
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: (toFirestoreValue(data).mapValue as { fields: unknown }).fields }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
};
