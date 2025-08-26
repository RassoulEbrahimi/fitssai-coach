import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { motion, AnimatePresence } from "framer-motion";

const ThemeToggle = () => {
  const { actualTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    // Add smooth transition effect for theme changes
    document.documentElement.style.transition = 'background-color 0.3s ease-in-out, color 0.3s ease-in-out';
    
    setTheme(actualTheme === "light" ? "dark" : "light");
    
    // Remove transition after animation completes
    setTimeout(() => {
      document.documentElement.style.transition = '';
    }, 300);
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
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Moon className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Sun className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </Button>
  );
};

export default ThemeToggle;