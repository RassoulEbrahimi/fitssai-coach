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

export const accountStorageKey = (key: string, ownerUid: string): string =>
  `${key}:${encodeURIComponent(ownerUid)}`;
