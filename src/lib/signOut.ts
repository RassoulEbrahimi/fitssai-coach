import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { clearSignOutSensitiveStorage } from '@/lib/storage';

/** The sole production Firebase sign-out entry point. */
export const signOutAccount = async (): Promise<void> => {
  await firebaseSignOut(auth);
  clearSignOutSensitiveStorage();
};
