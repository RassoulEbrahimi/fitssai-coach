import { auth } from '@/lib/firebase';

export class AccountChangedError extends Error {
  constructor() {
    super('The authenticated account no longer owns this operation.');
  }
}

/** Ownership is supplied by the creator/entry, never by mutable payload fields. */
export const assertAccountOwner = (ownerUid: string | null | undefined): string => {
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) throw new AccountChangedError();
  return ownerUid;
};

/**
 * The owner check for a live, multi-step write.
 *
 * Checking identity once on the way in is not enough: an operation started by A
 * can await a read, have authentication switch to B underneath it, and carry on
 * to a write it planned while it was still A's. So the expected owner is
 * captured here, at the start, and closed over — the returned checkpoint can
 * only ever compare against that captured UID. It cannot be re-pointed at
 * whoever is signed in now, which is the whole point: the operation either
 * finishes as the account that began it or it does not finish at all.
 *
 * Call the checkpoint after every await that precedes a write.
 */
export const beginAccountOperation = (expectedUid: string | null | undefined): (() => void) => {
  const ownerUid = assertAccountOwner(expectedUid);
  return () => { assertAccountOwner(ownerUid); };
};

export const accountStorageKey = (key: string, ownerUid: string): string =>
  `${key}:${encodeURIComponent(ownerUid)}`;
