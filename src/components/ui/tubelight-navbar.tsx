"use client"
import React, { useEffect, useState } from "react"
import { motion } from "framer-motion"
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
  const [isHidden, setIsHidden] = useState(false)
  const [lastScrollY, setLastScrollY] = useState(0)
  const [pressedButton, setPressedButton] = useState<string | null>(null)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Auto-hide on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      
      // Only hide if scrolled down more than 50px
      if (currentScrollY > 50) {
        if (currentScrollY > lastScrollY) {
          // Scrolling down - hide navbar
          setIsHidden(true)
        } else {
          // Scrolling up - show navbar
          setIsHidden(false)
        }
      } else {
        // At top of page - always show
        setIsHidden(false)
      }
      
      setLastScrollY(currentScrollY)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [lastScrollY])

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
          y: isHidden ? 80 : 0, 
          opacity: isHidden ? 0 : 1 
        }}
        transition={{ type: "spring", stiffness: 150, damping: 20 }}
        className="relative flex items-center justify-center"
        style={{ willChange: 'transform' }}
      >
        {/* Soft neon glow shadow below navbar - centered radial glow */}
        <div className={cn(
          "absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] rounded-full blur-xl transition-all duration-500",
          isDark 
            ? "from-emerald-500/25 via-emerald-500/15 to-transparent"
            : "from-emerald-400/20 via-emerald-300/10 to-transparent"
        )} />
        
        {/* Main navbar container - symmetric background */}
        <div className={cn(
          "relative flex items-center justify-center gap-3 rounded-full border backdrop-blur-xl py-1 px-1 transition-all duration-500 shadow-lg",
          isDark
            ? "bg-emerald-950/60 border-emerald-700/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
            : "bg-emerald-100/60 border-emerald-300/40 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
        )}>
          {items.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id

            return (
              <motion.button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                onTapStart={() => setPressedButton(item.id)}
                onTap={() => setTimeout(() => setPressedButton(null), 200)}
                onTapCancel={() => setPressedButton(null)}
                whileTap={{ scale: 0.95 }}
                animate={pressedButton === item.id ? {
                  scale: [1, 1.05, 1],
                } : {}}
                transition={{
                  scale: { duration: 0.2 }
                }}
                className={cn(
                  "relative cursor-pointer text-sm font-semibold px-6 py-2 rounded-full transition-colors",
                  "text-foreground/70 hover:text-emerald-300",
                  isActive && "text-emerald-400",
                )}
              >
                <motion.span 
                  className="hidden md:inline"
                  animate={isActive ? { y: -2 } : { y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {item.name}
                </motion.span>
                <motion.span 
                  className="md:hidden flex items-center justify-center"
                  animate={isActive ? { 
                    y: -2,
                    scale: [1, 1.08, 1]
                  } : { 
                    y: 0,
                    scale: 1 
                  }}
                  transition={{ 
                    duration: 0.2,
                    scale: {
                      duration: 1,
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
                    animate={{
                      opacity: [0.6, 1, 0.6],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                      layout: {
                        type: "spring",
                        stiffness: 300,
                        damping: 30,
                      }
                    }}
                  >
                    {/* Tubelight lamp effect with enhanced glow */}
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-emerald-400 rounded-t-full">
                      {/* Outer glow */}
                      <motion.div 
                        className="absolute w-12 h-6 bg-emerald-400/40 rounded-full blur-lg -top-2 left-1/2 -translate-x-1/2"
                        animate={{ opacity: [0.4, 0.7, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                      {/* Middle glow */}
                      <motion.div 
                        className="absolute w-8 h-6 bg-emerald-400/50 rounded-full blur-md -top-1 left-1/2 -translate-x-1/2"
                        animate={{ opacity: [0.5, 0.8, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                      {/* Inner bright core */}
                      <motion.div 
                        className="absolute w-4 h-4 bg-emerald-300/60 rounded-full blur-sm top-0 left-1/2 -translate-x-1/2"
                        animate={{ opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  </motion.div>
                )}
                
                {/* Press feedback ripple */}
                {pressedButton === item.id && (
                  <motion.div
                    className="absolute inset-0 bg-emerald-400/30 rounded-full -z-10"
                    initial={{ scale: 0.8, opacity: 0.6 }}
                    animate={{ scale: 1.2, opacity: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
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
