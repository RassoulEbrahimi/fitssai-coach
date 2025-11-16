-- Add file size limit policy for avatars bucket (5MB max)
CREATE POLICY "Avatar size limit"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND (metadata->>'size')::int < 5242880 -- 5MB = 5 × 1024 × 1024 bytes
);

-- Add file type restriction policy for avatars bucket
CREATE POLICY "Avatar type restriction"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND lower(substring(name from '[^.]+$')) = ANY(ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
);