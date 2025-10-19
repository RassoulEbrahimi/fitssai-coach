import React from "react";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AnimatedAvatarProps {
  src?: string | null;
  alt?: string;
  fallback?: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

export const AnimatedAvatar = React.forwardRef<
  HTMLDivElement,
  AnimatedAvatarProps
>(({ src, alt = "User Avatar", fallback, className, imageClassName, fallbackClassName }, ref) => {
  return (
    <motion.div
      ref={ref}
      animate={{
        scale: [1, 1.05, 1],
        boxShadow: [
          "0 0 8px rgba(16,185,129,0.35)",
          "0 0 18px rgba(16,185,129,0.55)",
          "0 0 8px rgba(16,185,129,0.35)",
        ],
      }}
      transition={{ 
        duration: 4, 
        repeat: Infinity, 
        ease: "easeInOut" 
      }}
      className={cn(
        "p-[2px] rounded-full bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-700 shadow-[0_0_20px_rgba(16,185,129,0.3)]",
        className
      )}
    >
      <Avatar className="w-full h-full border-2 border-emerald-400/60">
        <AvatarImage 
          src={src || ""} 
          alt={alt}
          className={cn("object-cover", imageClassName)}
          decoding="async"
          loading="lazy"
        />
        <AvatarFallback 
          className={cn(
            "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white font-bold",
            fallbackClassName
          )}
        >
          {fallback}
        </AvatarFallback>
      </Avatar>
    </motion.div>
  );
});

AnimatedAvatar.displayName = "AnimatedAvatar";
