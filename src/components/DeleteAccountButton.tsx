import React, { useState } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DELETION_RESPONSE_COMMITMENT,
  SUPPORT_EMAIL,
  isDeletionSupportConfigured,
} from "@/lib/accountDeletion";

/**
 * Account deletion.
 *
 * Phase 1 has no self-service deletion, so the only truthful action is to
 * hand over a real support contact. Until both the support address and the
 * response commitment are configured, this renders nothing at all — a button
 * that opens a dialog telling people to "contact support" without saying who
 * or how long is worse than no button.
 */
export const DeleteAccountButton: React.FC = () => {
  const [showConfirm, setShowConfirm] = useState(false);

  if (!isDeletionSupportConfigured()) return null;

  return (
    <>
      <motion.button
        onClick={() => setShowConfirm(true)}
        className="w-full mt-4 px-6 py-4 rounded-full bg-gradient-to-r from-rose-600/30 via-red-500/25 to-rose-700/30 backdrop-blur-xl border border-rose-500/40 text-rose-300 font-medium flex items-center justify-center gap-3 relative overflow-hidden"
        whileHover={{ scale: 1.03, boxShadow: "0 0 25px rgba(244, 63, 94, 0.4)" }}
        whileTap={{ scale: 0.98 }}
      >
        <Trash2 className="w-5 h-5" aria-hidden="true" />
        <span className="text-base">Konto löschen</span>
      </motion.button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-background/95 backdrop-blur-xl border-rose-500/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-400">Konto löschen</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Schreib uns an {SUPPORT_EMAIL}, um dein Konto löschen zu lassen.
              Wir melden uns {DELETION_RESPONSE_COMMITMENT}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-rose-500/30 hover:bg-rose-500/10">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => setShowConfirm(false)}
              className="bg-gradient-to-r from-rose-600 to-red-600 text-white"
            >
              Verstanden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
