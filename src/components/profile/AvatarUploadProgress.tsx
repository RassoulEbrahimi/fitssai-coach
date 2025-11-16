import React from 'react';
import { motion } from 'framer-motion';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';

interface AvatarUploadProgressProps {
  progress: number;
  status: 'compressing' | 'uploading' | 'finished';
}

export const AvatarUploadProgress = ({ progress, status }: AvatarUploadProgressProps) => {
  const statusText = status === 'compressing' ? 'Compressing image...' : 'Uploading...';
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm p-6 mx-4 space-y-4 rounded-xl bg-card border border-border shadow-lg">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{statusText}</p>
            <p className="text-xs text-muted-foreground">{Math.round(progress)}%</p>
          </div>
        </div>
        
        <Progress value={progress} className="h-2" />
      </div>
    </motion.div>
  );
};
