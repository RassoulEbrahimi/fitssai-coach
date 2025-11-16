import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import Cropper, { Area } from 'react-easy-crop';
import { ZoomIn } from 'lucide-react';

interface AvatarCropDialogProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  onCropped: (croppedFile: File) => void;
}

export const AvatarCropDialog = ({ open, onClose, file, onCropped }: AvatarCropDialogProps) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [imageSrc, setImageSrc] = useState<string>('');

  // Load image when file changes
  React.useEffect(() => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, [file]);

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createCroppedImage = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    try {
      const image = await createImage(imageSrc);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // Set canvas size to 512x512 (final output size)
      canvas.width = 512;
      canvas.height = 512;

      // Draw the cropped image
      ctx.drawImage(
        image,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        512,
        512
      );

      // Convert to blob
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'));
              return;
            }
            resolve(blob);
          },
          'image/png',
          1
        );
      });
    } catch (error) {
      console.error('Error creating cropped image:', error);
      throw error;
    }
  }, [imageSrc, croppedAreaPixels]);

  const handleApplyCrop = async () => {
    try {
      const croppedBlob = await createCroppedImage();
      if (!croppedBlob || !file) return;

      // Get original filename without extension
      const originalName = file.name.replace(/\.[^/.]+$/, '');
      
      // Create a new File from the cropped blob
      const croppedFile = new File(
        [croppedBlob],
        `${originalName}-cropped.png`,
        { type: 'image/png' }
      );

      onCropped(croppedFile);
      handleClose();
    } catch (error) {
      console.error('Error applying crop:', error);
    }
  };

  const handleClose = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setImageSrc('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Crop Profile Picture</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cropper Container */}
          <div className="relative w-full h-[400px] bg-muted rounded-lg overflow-hidden">
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
              />
            )}
          </div>

          {/* Zoom Slider */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ZoomIn className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Zoom</span>
            </div>
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.1}
              onValueChange={(value) => setZoom(value[0])}
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApplyCrop} className="gradient-primary">
            Apply Crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Helper function to create an image element from a source
const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.src = url;
  });
