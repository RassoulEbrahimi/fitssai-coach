import React, { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  const prefersReducedMotion = useReducedMotion();
  const [rippleActive, setRippleActive] = useState(false);

  const triggerRipple = () => {
    if (prefersReducedMotion) return;
    setRippleActive(true);
    setTimeout(() => setRippleActive(false), 600);
  };

  return (
    <motion.div
      ref={ref}
      onClick={triggerRipple}
      whileHover={prefersReducedMotion ? undefined : { scale: 1.06 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
      animate={!prefersReducedMotion ? {
        scale: [1, 1.03, 1],
        filter: [
          "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
          "drop-shadow(0 0 18px rgba(0, 255, 156, 0.22))",
          "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
        ]
      } : {
        filter: "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
      }}
      transition={{ 
        duration: 4.5, 
        repeat: prefersReducedMotion ? 0 : Infinity, 
        ease: "easeInOut" 
      }}
      className={cn(
        "p-[2px] rounded-full cursor-pointer touch-manipulation relative",
        isDark
          ? "bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-700"
          : "bg-white/30 backdrop-blur-md border border-emerald-200/60",
        className
      )}
      style={{ willChange: 'transform, filter' }}
    >
      {/* Touch ripple effect */}
      {rippleActive && (
        <motion.div
          className="absolute inset-0 rounded-full bg-emerald-400/25 blur-md pointer-events-none"
          initial={{ scale: 0.9, opacity: 0.25 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ zIndex: 0 }}
        />
      )}
      {/* Optimized glow effect using CSS only */}
      <div 
        className={cn(
          "absolute inset-0 rounded-full blur-md -z-10",
          isDark ? "bg-emerald-400/30" : "bg-white/40",
          !prefersReducedMotion && "animate-pulse"
        )}
        style={{ animationDuration: '4s' }}
      />
      
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
