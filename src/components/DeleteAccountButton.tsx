import React, { useState } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
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

export const DeleteAccountButton: React.FC = () => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleDeleteAccount = async () => {
    try {
      setIsDeleting(true);
      
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("No active session found");
      }

      // Call the edge function to delete account
      const { data, error } = await supabase.functions.invoke('delete-account', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      // Show success message
      toast({
        title: "Konto gelöscht",
        description: "Dein Konto und alle Daten wurden erfolgreich entfernt.",
      });
      
      // Clear local storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Fade out and redirect
      setTimeout(() => {
        navigate("/auth");
      }, 500);
      
    } catch (error) {
      console.error("Account deletion failed:", error);
      toast({
        title: "Fehler",
        description: "Konto konnte nicht gelöscht werden. Bitte versuche es erneut.",
        variant: "destructive",
      });
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setShowConfirm(true)}
        className="w-full mt-4 px-6 py-4 rounded-full bg-gradient-to-r from-rose-600/30 via-red-500/25 to-rose-700/30 backdrop-blur-xl border border-rose-500/40 text-rose-300 font-medium flex items-center justify-center gap-3 relative overflow-hidden"
        whileHover={{ 
          scale: 1.03,
          boxShadow: "0 0 25px rgba(244, 63, 94, 0.4)"
        }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        animate={{
          boxShadow: [
            "0 0 15px rgba(244, 63, 94, 0.2)",
            "0 0 20px rgba(244, 63, 94, 0.3)",
            "0 0 15px rgba(244, 63, 94, 0.2)",
          ],
        }}
        style={{
          transition: "box-shadow 2s ease-in-out infinite",
        }}
        disabled={isDeleting}
      >
        <Trash2 className="w-5 h-5" />
        <span className="text-base">Konto löschen</span>
        
        {/* Animated glow background */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-rose-500/0 via-rose-500/10 to-rose-500/0"
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
        <AlertDialogContent className="bg-background/95 backdrop-blur-xl border-rose-500/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-400">
              Konto löschen bestätigen
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Bist du sicher, dass du dein Konto dauerhaft löschen möchtest?
              <br />
              <span className="font-semibold text-rose-300 mt-2 block">
                Alle deine Daten werden unwiderruflich entfernt.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              className="border-rose-500/30 hover:bg-rose-500/10"
              disabled={isDeleting}
            >
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={isDeleting}
              className="bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white"
            >
              {isDeleting ? "Wird gelöscht..." : "Ja, löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
