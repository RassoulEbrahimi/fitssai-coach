import React, { useState } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

// Account deletion requires Firebase Cloud Functions (Blaze plan).
// Temporarily disabled — shows contact-support message.
export const DeleteAccountButton: React.FC = () => {
  const [showConfirm, setShowConfirm] = useState(false);
  const { toast } = useToast();

  const handleDeleteAccount = () => {
    setShowConfirm(false);
    toast({
      title: "Kontolöschung vorübergehend deaktiviert",
      description: "Bitte wende dich an den Support, um dein Konto zu löschen.",
    });
  };

  return (
    <>
      <motion.button
        onClick={() => setShowConfirm(true)}
        className="w-full mt-4 px-6 py-4 rounded-full bg-gradient-to-r from-rose-600/30 via-red-500/25 to-rose-700/30 backdrop-blur-xl border border-rose-500/40 text-rose-300 font-medium flex items-center justify-center gap-3 relative overflow-hidden"
        whileHover={{ scale: 1.03, boxShadow: "0 0 25px rgba(244, 63, 94, 0.4)" }}
        whileTap={{ scale: 0.98 }}
      >
        <Trash2 className="w-5 h-5" />
        <span className="text-base">Konto löschen</span>
      </motion.button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-background/95 backdrop-blur-xl border-rose-500/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-400">Konto löschen</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Die Kontolöschung ist während der Firebase-Migration vorübergehend deaktiviert.
              Bitte wende dich an den Support.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-rose-500/30 hover:bg-rose-500/10">Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAccount} className="bg-gradient-to-r from-rose-600 to-red-600 text-white">Verstanden</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
