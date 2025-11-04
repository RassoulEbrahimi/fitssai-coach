import { motion } from "framer-motion";
import { Brain } from "lucide-react";

interface AdaptiveHintProps {
  message: string;
}

export function AdaptiveHint({ message }: AdaptiveHintProps) {
  if (!message) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 italic mt-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800"
    >
      <Brain className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span>🤖 Lernt aus deinem Feedback: {message}</span>
    </motion.div>
  );
}
