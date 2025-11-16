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
 * @param userId - User ID
 * @param file - File to upload
 * @param onProgress - Optional callback to track upload progress (0-100)
 */
export const uploadAvatar = async (
  userId: string, 
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${userId}/profile.${fileExt}`;
  
  // If progress tracking is not needed, use standard upload
  if (!onProgress) {
    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, {
        upsert: true,
        contentType: file.type
      });

    if (error) {
      throw error;
    }

    return data.path;
  }

  // Use XMLHttpRequest for progress tracking
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        
        if (!token) {
          throw new Error('No authentication token available');
        }

        const xhr = new XMLHttpRequest();
        const projectUrl = 'https://zkamhncwbgieifloosqn.supabase.co';
        const uploadUrl = `${projectUrl}/storage/v1/object/avatars/${fileName}`;

        xhr.upload.addEventListener('progress', (evt) => {
          if (evt.lengthComputable) {
            const percentComplete = (evt.loaded / evt.total) * 100;
            onProgress(percentComplete);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(100);
            resolve(fileName);
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.setRequestHeader('x-upsert', 'true');
        
        xhr.send(file);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
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