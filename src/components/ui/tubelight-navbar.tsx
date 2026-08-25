"use client"
import React, { useEffect, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/useTheme"
import { GlassFilter } from "./glass-filter"
import { useFocusMode } from "@/contexts/FocusModeContext"

interface NavItem {
  name: string
  id: string
  icon: LucideIcon
}

interface NavBarProps {
  items: NavItem[]
  activeTab: string
  onTabChange: (id: string) => void
  enableAdvancedGlass?: boolean
  className?: string
}

export const NavBar = React.forwardRef<HTMLElement, NavBarProps>(
  ({ items, activeTab, onTabChange, enableAdvancedGlass = false, className }, ref) => {
  const [isMobile, setIsMobile] = useState(false)
  const { actualTheme } = useTheme()
  const isDark = actualTheme === "dark"
  const [pressedButton, setPressedButton] = useState<string | null>(null)
  const prefersReducedMotion = useReducedMotion()
  const [activeShimmer, setActiveShimmer] = useState(false)
  const shimmerTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const { isFocusMode } = useFocusMode()

  // Dynamic shimmer color mapping based on active tab
  const getShimmerColors = React.useCallback(() => {
    const tabIndex = items.findIndex(item => item.id === activeTab)
    const colors = [
      { ambient: 'rgba(16, 185, 129, 0.025)', active: 'rgba(16, 185, 129, 0.06)' }, // emerald
      { ambient: 'rgba(59, 130, 246, 0.025)', active: 'rgba(59, 130, 246, 0.06)' },  // blue
      { ambient: 'rgba(168, 85, 247, 0.025)', active: 'rgba(168, 85, 247, 0.06)' },  // purple
      { ambient: 'rgba(236, 72, 153, 0.025)', active: 'rgba(236, 72, 153, 0.06)' },  // pink
    ]
    return colors[tabIndex % colors.length] || colors[0]
  }, [activeTab, items])

  const shimmerColors = getShimmerColors()

  // Computed flag: shimmer enabled only if advanced glass is ON and motion is allowed
  const shimmerEnabled = enableAdvancedGlass && !prefersReducedMotion;

  const triggerActiveShimmer = React.useCallback(() => {
    if (!shimmerEnabled) return
    setActiveShimmer(true)
    if (shimmerTimeoutRef.current) clearTimeout(shimmerTimeoutRef.current)
    shimmerTimeoutRef.current = setTimeout(() => setActiveShimmer(false), 1600)
  }, [shimmerEnabled])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    const handleScroll = () => triggerActiveShimmer()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [triggerActiveShimmer])

  useEffect(() => {
    triggerActiveShimmer()
  }, [activeTab, triggerActiveShimmer])

  useEffect(() => {
    return () => {
      if (shimmerTimeoutRef.current) clearTimeout(shimmerTimeoutRef.current)
    }
  }, [])

  return (
    <>
      <style>{`
        @keyframes shimmer-ambient {
          0% {
            background-position: -250% -250%;
          }
          100% {
            background-position: 250% 250%;
          }
        }
        
        @keyframes shimmer-active {
          0% {
            background-position: -180% -180%;
            opacity: 0;
          }
          30% {
            opacity: 1;
          }
          100% {
            background-position: 180% 180%;
            opacity: 0;
          }
        }
      `}</style>
      
      <motion.nav 
        ref={ref}
        id="navigation"
        aria-label="Hauptnavigation"
        tabIndex={-1}
        initial={false}
        animate={{
          y: isFocusMode ? 100 : 0,
          opacity: isFocusMode ? 0 : 1,
        }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 30,
        }}
        className={cn(
          "fixed bottom-4 inset-x-0 z-50 pointer-events-none",
          isFocusMode && "pointer-events-none",
          className,
        )}
        style={{ 
          paddingBottom: 'env(safe-area-inset-bottom)' 
        }}
      >
        {/* Glass filter definition */}
        <GlassFilter />
      
      {/* Flex container to center the navbar */}
      <div className="flex justify-center">
        {/* Relative wrapper with overflow-hidden and rounded-full for glass layer */}
        <div 
          className="relative overflow-hidden rounded-full pointer-events-auto"
          onMouseMove={!prefersReducedMotion ? triggerActiveShimmer : undefined}
        >
          {/* Frosted glass background layer - outside animation context */}
          <div 
            className={cn(
              "absolute inset-0 rounded-full pointer-events-none",
              isDark
                ? "bg-emerald-950/25"
                : "bg-emerald-100/25"
            )}
            style={{ 
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              backgroundImage: `url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAQklEQVRYR+2WQQ4AIAhDuf9/Zq9gsiSYmc8mEh+ttKKqiKiFVFUVEREREREREREREREREREREREREREREREREREREdksgAeNCRCbp/TzAAAAAElFTkSuQmCC")`,
              backgroundSize: '128px 128px',
              backgroundRepeat: 'repeat',
            }}
          />
          
          {/* Ambient shimmer layer - smooth transition based on preference */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-700 ease-in-out"
            style={{
              opacity: shimmerEnabled ? 1 : 0,
              backgroundImage: `
                radial-gradient(ellipse 120% 80% at 50% 50%, transparent 40%, ${shimmerColors.ambient} 50%, transparent 60%),
                linear-gradient(125deg, transparent 25%, ${shimmerColors.ambient} 45%, rgba(255,255,255,0.035) 50%, ${shimmerColors.ambient} 55%, transparent 75%)
              `,
              backgroundSize: '500% 500%',
              backgroundBlendMode: 'soft-light',
              animation: shimmerEnabled ? 'shimmer-ambient 7.5s ease-in-out infinite' : 'none',
              willChange: shimmerEnabled ? 'background-position, opacity' : 'opacity',
            }}
          />

          {/* Active shimmer layer - smooth transition based on preference */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-500 ease-in-out"
            style={{
              opacity: shimmerEnabled && activeShimmer ? 1 : 0,
              backgroundImage: `
                linear-gradient(130deg, transparent 20%, ${shimmerColors.active} 45%, rgba(255,255,255,0.08) 50%, ${shimmerColors.active} 55%, transparent 80%)
              `,
              backgroundSize: '400% 400%',
              backgroundBlendMode: 'overlay',
              animation: shimmerEnabled && activeShimmer ? 'shimmer-active 1.6s ease-out forwards' : 'none',
              willChange: shimmerEnabled && activeShimmer ? 'background-position, opacity' : 'opacity',
            }}
          />
          
          {/* Animated content wrapper - ALL animations here */}
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ 
              y: 0, 
              opacity: 1 
            }}
            transition={{ 
              type: prefersReducedMotion ? "tween" : "spring", 
              stiffness: 150, 
              damping: 20,
              duration: prefersReducedMotion ? 0.2 : undefined
            }}
            className="relative flex items-center justify-center"
            style={{ willChange: 'transform, opacity' }}
          >
            {/* Soft neon glow shadow below navbar - optimized with CSS only */}
            <div className={cn(
              "absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] rounded-full blur-lg transition-opacity duration-500",
              isDark 
                ? "from-emerald-500/25 via-emerald-500/15 to-transparent"
                : "from-emerald-400/20 via-emerald-300/10 to-transparent"
            )} 
            style={{ willChange: 'opacity' }}
            />
            
            {/* Main navbar container - no backdrop here, just structure */}
            <div 
              className={cn(
                "relative flex items-center justify-center gap-3 rounded-full border py-1 px-1 transition-all duration-500 shadow-lg",
                isDark
                  ? "border-emerald-700/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                  : "border-emerald-300/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
              )}
            >
            
            {/* Navigation items - positioned above glass background */}
            <div className="relative z-10 flex items-center gap-3">
          {items.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id

            return (
              <motion.button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                onTapStart={() => !prefersReducedMotion && setPressedButton(item.id)}
                onTap={() => !prefersReducedMotion && setTimeout(() => setPressedButton(null), 200)}
                onTapCancel={() => setPressedButton(null)}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.95 }}
                animate={!prefersReducedMotion && pressedButton === item.id ? {
                  scale: [1, 1.05, 1],
                } : {}}
                transition={{
                  scale: { duration: 0.2 }
                }}
                className={cn(
                  "relative cursor-pointer text-sm font-semibold px-6 py-2 rounded-full transition-colors touch-manipulation",
                  "text-foreground/70 hover:text-emerald-700 dark:hover:text-emerald-300",
                  isActive && "text-emerald-700 dark:text-emerald-400",
                )}
                style={{ willChange: isActive ? 'transform' : 'auto' }}
              >
                <motion.span 
                  className="hidden md:inline"
                  animate={!prefersReducedMotion && isActive ? { y: -2 } : { y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {item.name}
                </motion.span>
                <motion.span 
                  className={cn(
                    "md:hidden flex items-center justify-center",
                    isActive && !prefersReducedMotion && "animate-[emeraldGlow_2.5s_ease-in-out_infinite]"
                  )}
                  animate={!prefersReducedMotion && isActive ? { 
                    y: -2,
                    scale: [1, 1.05, 1],
                    filter: [
                      "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                      "drop-shadow(0 0 6px rgba(0, 255, 156, 0.5))",
                      "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
                    ]
                  } : { 
                    y: 0,
                    scale: 1,
                    filter: "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
                  }}
                  transition={{ 
                    duration: 0.2,
                    scale: {
                      duration: 2.5,
                      repeat: isActive ? Infinity : 0,
                      ease: "easeInOut"
                    },
                    filter: {
                      duration: 2.5,
                      repeat: isActive ? Infinity : 0,
                      ease: "easeInOut"
                    }
                  }}
                >
                  <Icon size={isMobile ? 22 : 20} strokeWidth={2.5} />
                </motion.span>
                
                {isActive && (
                  <motion.div
                    layoutId="lamp"
                    className="absolute inset-0 w-full bg-emerald-400/60 rounded-full -z-10"
                    initial={false}
                    animate={!prefersReducedMotion ? {
                      opacity: [0.6, 0.85, 0.6],
                    } : { opacity: 0.7 }}
                    transition={{
                      duration: 3,
                      repeat: prefersReducedMotion ? 0 : Infinity,
                      ease: "easeInOut",
                      layout: {
                        type: "spring",
                        stiffness: 300,
                        damping: 30,
                      }
                    }}
                    style={{ willChange: 'opacity' }}
                  >
                    {/* Tubelight lamp effect - optimized with CSS only glow */}
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-emerald-400 rounded-t-full">
                      {/* Single optimized glow layer */}
                      <div 
                        className={cn(
                          "absolute w-10 h-6 bg-emerald-400/50 rounded-full blur-md -top-2 left-1/2 -translate-x-1/2",
                          !prefersReducedMotion && "animate-pulse"
                        )}
                        style={{ animationDuration: '3s' }}
                      />
                    </div>
                  </motion.div>
                )}
                
                {/* Press feedback ripple - only when motion allowed */}
                {!prefersReducedMotion && pressedButton === item.id && (
                  <motion.div
                    className="absolute inset-0 bg-emerald-400/30 rounded-full -z-10"
                    initial={{ scale: 0.9, opacity: 0.5 }}
                    animate={{ scale: 1.15, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    style={{ willChange: 'transform, opacity' }}
                  />
                )}
              </motion.button>
            )
          })}
            </div>
          </div>
        </motion.div>
        </div> {/* Close relative wrapper for glass layer */}
      </div> {/* Close flex container */}
      </motion.nav>
    </>
  )
})

NavBar.displayName = "NavBar"
