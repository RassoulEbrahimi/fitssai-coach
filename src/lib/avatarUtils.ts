import { supabase } from "@/integrations/supabase/client";

/**
 * Get avatar URL from storage path with cache busting
 */
export const getAvatarUrl = (avatarPath: string | null, cacheBuster?: string): string | null => {
  if (!avatarPath) return null;
  
  try {
    const { data } = supabase.storage.from('avatars').getPublicUrl(avatarPath);
    const url = data.publicUrl;
    
    // Add cache buster if provided (for fresh uploads)
    if (cacheBuster) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}v=${cacheBuster}`;
    }
    
    return url;
  } catch (error) {
    console.error('Error getting avatar URL:', error);
    return null;
  }
};

/**
 * Upload avatar file and return the storage path
 */
export const uploadAvatar = async (userId: string, file: File): Promise<string> => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${userId}/profile.${fileExt}`;
  
  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(fileName, file, {
      upsert: true, // Replace existing file
      contentType: file.type
    });

  if (error) {
    throw error;
  }

  return data.path;
};

/**
 * Update user profile with new avatar path
 */
export const updateProfileAvatar = async (userId: string, avatarPath: string): Promise<void> => {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: avatarPath })
    .eq('id', userId);

  if (error) {
    throw error;
  }
};