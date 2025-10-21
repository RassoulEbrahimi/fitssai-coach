import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const ThemeToggle = () => {
  const { actualTheme, setTheme } = useTheme();
  const prefersReducedMotion = useReducedMotion();

  const toggleTheme = () => {
    // Add smooth transition effect for theme changes
    if (!prefersReducedMotion) {
      document.documentElement.style.transition = 'background-color 0.3s ease-in-out, color 0.3s ease-in-out';
      
      setTimeout(() => {
        document.documentElement.style.transition = '';
      }, 300);
    }
    
    setTheme(actualTheme === "light" ? "dark" : "light");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-9 w-9 transition-smooth hover:bg-accent hover:scale-105"
      aria-label={`Switch to ${actualTheme === "light" ? "dark" : "light"} mode`}
    >
      <AnimatePresence mode="wait">
        {actualTheme === "light" ? (
          <motion.div
            key="moon"
            initial={prefersReducedMotion ? { opacity: 0 } : { rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { rotate: -90, opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.1 : 0.2 }}
          >
            <Moon className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={prefersReducedMotion ? { opacity: 0 } : { rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { rotate: 90, opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.1 : 0.2 }}
          >
            <Sun className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </Button>
  );
};

export default ThemeToggle;