"use client"
import React, { useEffect, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/useTheme"

interface NavItem {
  name: string
  id: string
  icon: LucideIcon
}

interface NavBarProps {
  items: NavItem[]
  activeTab: string
  onTabChange: (id: string) => void
  className?: string
}

export const NavBar = React.forwardRef<HTMLDivElement, NavBarProps>(
  ({ items, activeTab, onTabChange, className }, ref) => {
  const [isMobile, setIsMobile] = useState(false)
  const { actualTheme } = useTheme()
  const isDark = actualTheme === "dark"
  const [pressedButton, setPressedButton] = useState<string | null>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <div 
      ref={ref}
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex justify-center items-center w-fit",
        className,
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
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
        
        {/* Main navbar container - optimized backdrop */}
        <div 
          className={cn(
            "relative flex items-center justify-center gap-3 rounded-full border backdrop-blur-md py-1 px-1 transition-all duration-500 shadow-lg",
            isDark
              ? "bg-emerald-950/60 border-emerald-700/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
              : "bg-emerald-100/60 border-emerald-300/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
          )}
          style={{ willChange: 'opacity' }}
        >
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
                  "text-foreground/70 hover:text-emerald-300",
                  isActive && "text-emerald-400",
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
                  className="md:hidden flex items-center justify-center"
                  animate={!prefersReducedMotion && isActive ? { 
                    y: -2,
                    scale: [1, 1.06, 1]
                  } : { 
                    y: 0,
                    scale: 1 
                  }}
                  transition={{ 
                    duration: 0.2,
                    scale: {
                      duration: 1.5,
                      repeat: isActive ? Infinity : 0,
                      repeatType: "reverse",
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
      </motion.div>
    </div>
  )
})

NavBar.displayName = "NavBar"
