/**
 * Compress and resize an image file before upload
 * @param file - The original image file
 * @param maxSize - Maximum dimension (width or height) in pixels
 * @param quality - Compression quality (0-1)
 * @returns Compressed image file
 */
export const compressImage = async (
  file: File,
  maxSize: number = 512,
  quality: number = 0.75
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        // Use better image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        
        // Determine output format and extension
        let mimeType = 'image/webp';
        let extension = 'webp';
        
        // Fallback to JPEG if WebP is not supported
        if (!canvas.toDataURL('image/webp').startsWith('data:image/webp')) {
          mimeType = 'image/jpeg';
          extension = 'jpg';
        }
        
        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            
            // Get original filename without extension
            const originalName = file.name.replace(/\.[^/.]+$/, '');
            
            // Create new file with compressed data
            const compressedFile = new File(
              [blob],
              `${originalName}.${extension}`,
              { type: mimeType }
            );
            
            console.log(`Image compressed: ${(file.size / 1024).toFixed(1)}KB → ${(compressedFile.size / 1024).toFixed(1)}KB`);
            resolve(compressedFile);
          },
          mimeType,
          quality
        );
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
  });
};
