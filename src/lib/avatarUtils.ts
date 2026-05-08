// Avatar features disabled — Firebase Storage requires Blaze plan.
// Avatars are replaced with initials throughout the app.

export const getAvatarUrl = (_avatarPath?: string | null): string | null => null;

export const uploadAvatar = async (_file: File, _userId: string): Promise<string | null> => {
  throw new Error("Avatar-Upload ist während der Firebase-Migration vorübergehend deaktiviert.");
};

export const updateProfileAvatar = async (_userId: string, _avatarPath: string): Promise<void> => {
  // no-op
};
