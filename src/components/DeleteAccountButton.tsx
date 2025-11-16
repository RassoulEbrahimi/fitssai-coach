import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  const [showExitAnimation, setShowExitAnimation] = useState(false);
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

      // Request deletion with grace period
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { action: 'request' },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      // Show success message with grace period info
      toast({
        title: "Löschung geplant",
        description: `Dein Konto wird in 14 Tagen gelöscht. Du kannst die Löschung jederzeit in den Einstellungen abbrechen.`,
      });
      
      setIsDeleting(false);
      setShowConfirm(false);
      
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "Anfrage konnte nicht verarbeitet werden.",
        variant: "destructive",
      });
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      {/* Exit Animation Overlay */}
      <AnimatePresence>
        {showExitAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-md"
          >
            {/* Glow Collapse Effect */}
            <motion.div
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ 
                scale: [1, 1.5, 2.5],
                opacity: [0.8, 0.4, 0]
              }}
              transition={{ 
                duration: 1.2,
                ease: "easeOut"
              }}
              className="absolute w-64 h-64 rounded-full bg-gradient-to-r from-rose-500/40 via-red-500/30 to-rose-600/40 blur-3xl"
            />
            
            {/* Fade Text */}
            <motion.div
              initial={{ opacity: 1, y: 0 }}
              animate={{ 
                opacity: [1, 1, 0],
                y: [0, 0, -20]
              }}
              transition={{ 
                duration: 1.5,
                times: [0, 0.5, 1]
              }}
              className="relative z-10 text-center"
            >
              <motion.div
                animate={{
                  scale: [1, 1.05, 1],
                }}
                transition={{
                  duration: 1,
                  repeat: 1,
                  ease: "easeInOut"
                }}
              >
                <Trash2 className="w-16 h-16 mx-auto mb-4 text-rose-400" />
              </motion.div>
              <p className="text-xl font-medium text-rose-300">
                Konto wird gelöscht...
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
