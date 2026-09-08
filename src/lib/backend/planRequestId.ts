import { accountStorageKey } from "@/lib/accountIdentity";
import { newRequestId, type AiErrorCode } from "./planGeneration";

/**
 * The identity of one logical "generate a plan" action.
 *
 * The request id is what the server uses to decide whether a call is a new
 * generation or a second look at one it has already done. That only works if
 * the client sends the *same* id when it retries something it is unsure about.
 * A browser that mints a fresh id whenever a response fails to arrive turns
 * every uncertain call into a new logical request — a second model call, a
 * second plan and a second charge for one press of one button.
 *
 * So an id is minted once per press and kept until the server says something
 * definitive about it. A lost response, a timed-out callable or a request the
 * server reports as still running all reuse it; a completed generation and a
 * refusal that persisted nothing both clear it, so the next press is genuinely
 * a new request.
 *
 * The id is stored under the signed-in account's own key, never a shared one:
 * an id left behind by one account must not be sent as another account's
 * request. It is a plain string with no personal data in it, and the server
 * ignores it entirely unless it already has a record of that user having sent
 * it — see `functions/src/idempotency.ts`.
 */

const STORAGE_KEY = "AI_PLAN_REQUEST";

/**
 * How long an unsettled id is still worth reusing.
 *
 * The server's claim lease is four minutes, after which any interrupted
 * invocation has definitively stopped, and a completed one keeps its record
 * for good. Fifteen minutes is comfortably past the point where reusing the id
 * still reconciles a real attempt, and short enough that someone returning
 * later and pressing the button gets the new plan they are asking for.
 */
export const PENDING_REQUEST_TTL_MS = 15 * 60 * 1000;

interface PendingRequest {
  requestId: string;
  startedAt: number;
}

/**
 * Failures that end a logical attempt.
 *
 * Every one of them is a refusal the server made without persisting a plan, so
 * pressing the button again is a new request and deserves a new id. What is
 * deliberately absent is as important: INTERNAL covers a lost response, a
 * timed-out callable and a crash after the plan was already written, and
 * REQUEST_IN_PROGRESS means the server is still working on this very id.
 * Neither says the attempt produced nothing, so neither may throw its id away.
 */
const SETTLED_CODES: readonly AiErrorCode[] = [
  "UNAUTHENTICATED",
  "INVALID_REQUEST",
  "PROFILE_INCOMPLETE",
  "QUOTA_EXCEEDED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
  "PERSISTENCE_FAILED",
];

/** True when the outcome leaves it unknown whether a plan was created. */
export const isUncertainOutcome = (code: AiErrorCode): boolean =>
  !SETTLED_CODES.includes(code);

/**
 * A per-tab fallback for when storage is unavailable.
 *
 * Private-mode browsers throw on `localStorage`. Losing the id across a reload
 * there is a smaller problem than the generation failing outright, so the
 * in-memory copy keeps the common case — retry in the same tab — correct.
 */
const memory = new Map<string, PendingRequest>();

const isPending = (value: unknown): value is PendingRequest =>
  typeof (value as PendingRequest | null)?.requestId === "string" &&
  typeof (value as PendingRequest | null)?.startedAt === "number";

const read = (ownerUid: string): PendingRequest | null => {
  const inMemory = memory.get(ownerUid);
  if (inMemory) return inMemory;
  try {
    const raw = window.localStorage.getItem(accountStorageKey(STORAGE_KEY, ownerUid));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPending(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const write = (ownerUid: string, pending: PendingRequest): void => {
  memory.set(ownerUid, pending);
  try {
    window.localStorage.setItem(
      accountStorageKey(STORAGE_KEY, ownerUid),
      JSON.stringify(pending)
    );
  } catch {
    // The in-memory copy above still serves this tab.
  }
};

/**
 * The id to send for a press of the generate button.
 *
 * Reuses the id of an attempt whose outcome is still unknown, so the server
 * recognises the retry as the same logical request; mints a fresh one
 * otherwise, so a genuinely new generation is genuinely new.
 */
export const beginPlanRequest = (ownerUid: string, now: number = Date.now()): string => {
  const pending = read(ownerUid);
  if (pending && now - pending.startedAt < PENDING_REQUEST_TTL_MS) return pending.requestId;

  const requestId = newRequestId();
  write(ownerUid, { requestId, startedAt: now });
  return requestId;
};

/** The attempt is over one way or the other; the next press starts a new one. */
export const settlePlanRequest = (ownerUid: string): void => {
  memory.delete(ownerUid);
  try {
    window.localStorage.removeItem(accountStorageKey(STORAGE_KEY, ownerUid));
  } catch {
    // Nothing to clean up that matters: the in-memory copy is already gone.
  }
};
