"use client"
import React, { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

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

export function NavBar({ items, activeTab, onTabChange, className }: NavBarProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-fit max-w-[90vw]",
        className,
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="relative w-full">
        {/* Soft neon glow shadow below navbar */}
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 via-green-500/20 to-emerald-500/20 rounded-full blur-lg opacity-20" />
        
        {/* Main navbar container */}
        <div className="relative flex items-center justify-center gap-3 bg-gradient-to-r from-emerald-900/70 via-emerald-800/60 to-green-600/60 border border-emerald-900/60 backdrop-blur-xl py-1 px-1 rounded-full shadow-[0_0_20px_rgba(0,255,153,0.15)]">
          {items.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id

            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
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
                        className="absolute w-12 h-6 bg-emerald-400/40 rounded-full blur-lg -top-2 -left-2"
                        animate={{ opacity: [0.4, 0.7, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                      {/* Middle glow */}
                      <motion.div 
                        className="absolute w-8 h-6 bg-emerald-400/50 rounded-full blur-md -top-1"
                        animate={{ opacity: [0.5, 0.8, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                      {/* Inner bright core */}
                      <motion.div 
                        className="absolute w-4 h-4 bg-emerald-300/60 rounded-full blur-sm top-0 left-2"
                        animate={{ opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  </motion.div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
