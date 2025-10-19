import React, { useState } from "react";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

export const LogoutButton: React.FC = () => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      
      // Sign out from Supabase
      const { error } = await supabase.auth.signOut();
      
      if (error) throw error;
      
      // Clear storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Show success message
      toast({
        title: "Erfolgreich abgemeldet",
        description: "Du wurdest erfolgreich abgemeldet.",
      });
      
      // Fade out and redirect
      setTimeout(() => {
        navigate("/auth/sign-in");
      }, 300);
      
    } catch (error) {
      console.error("Logout failed:", error);
      toast({
        title: "Fehler",
        description: "Abmeldung fehlgeschlagen. Bitte versuche es erneut.",
        variant: "destructive",
      });
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setShowConfirm(true)}
        className="w-full mt-6 px-6 py-4 rounded-full bg-gradient-to-r from-emerald-600/30 via-green-500/25 to-emerald-700/30 backdrop-blur-xl border border-emerald-500/40 text-emerald-300 font-medium flex items-center justify-center gap-3 relative overflow-hidden"
        whileHover={{ 
          scale: 1.03,
          boxShadow: "0 0 25px rgba(16, 185, 129, 0.4)"
        }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        animate={{
          boxShadow: [
            "0 0 15px rgba(16, 185, 129, 0.2)",
            "0 0 20px rgba(16, 185, 129, 0.3)",
            "0 0 15px rgba(16, 185, 129, 0.2)",
          ],
        }}
        style={{
          transition: "box-shadow 2s ease-in-out infinite",
        }}
        disabled={isLoggingOut}
      >
        <LogOut className="w-5 h-5" />
        <span className="text-base">Abmelden</span>
        
        {/* Animated glow background */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/10 to-emerald-500/0"
          animate={{
            x: ["-100%", "100%"],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      </motion.button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-background/95 backdrop-blur-xl border-emerald-500/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-400">
              Abmelden bestätigen
            </AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du dich wirklich abmelden?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              className="border-emerald-500/30 hover:bg-emerald-500/10"
              disabled={isLoggingOut}
            >
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white"
            >
              {isLoggingOut ? "Wird abgemeldet..." : "Abmelden"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
