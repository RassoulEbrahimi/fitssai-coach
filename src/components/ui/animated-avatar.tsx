import React from "react";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

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
  const { actualTheme } = useTheme();
  const isDark = actualTheme === "dark";

  return (
    <motion.div
      ref={ref}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.97 }}
      animate={{
        scale: [1, 1.05, 1],
        boxShadow: isDark
          ? [
              "0 0 10px rgba(16,185,129,0.4)",
              "0 0 20px rgba(16,185,129,0.6)",
              "0 0 10px rgba(16,185,129,0.4)",
            ]
          : [
              "0 0 6px rgba(255,255,255,0.4)",
              "0 0 14px rgba(255,255,255,0.6)",
              "0 0 6px rgba(255,255,255,0.4)",
            ],
      }}
      transition={{ 
        duration: 4, 
        repeat: Infinity, 
        ease: "easeInOut" 
      }}
      className={cn(
        "p-[2px] rounded-full shadow-[0_0_20px_rgba(16,185,129,0.25)] cursor-pointer",
        isDark
          ? "bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-700"
          : "bg-white/30 backdrop-blur-lg border border-emerald-200/60",
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
