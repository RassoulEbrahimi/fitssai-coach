import { motion } from "framer-motion";
import { saveAIFeedback } from "@/integrations/supabase/tables/ai_feedback";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";

interface WorkoutFeedbackCardProps {
  suggestionId: string;
  onSubmitted?: () => void;
}

export function WorkoutFeedbackCard({ suggestionId, onSubmitted }: WorkoutFeedbackCardProps) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<"good" | "hard" | "light" | "notstyle" | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!user || !selected) return;
    await saveAIFeedback({
      user_id: user.id,
      suggestion_id: suggestionId,
      accepted: selected === "good",
      reason: reason || selected,
    });
    setSubmitted(true);
    onSubmitted?.();
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-center shadow-sm"
      >
        ✅ Danke für dein Feedback!
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="p-4 space-y-3">
        <h3 className="text-base font-semibold">Wie war dieses Training?</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Button
            variant={selected === "good" ? "default" : "outline"}
            onClick={() => setSelected("good")}
            className="w-full"
          >
            👍 Super
          </Button>
          <Button
            variant={selected === "hard" ? "default" : "outline"}
            onClick={() => setSelected("hard")}
            className="w-full"
          >
            🥵 Zu schwer
          </Button>
          <Button
            variant={selected === "light" ? "default" : "outline"}
            onClick={() => setSelected("light")}
            className="w-full"
          >
            😴 Zu leicht
          </Button>
          <Button
            variant={selected === "notstyle" ? "default" : "outline"}
            onClick={() => setSelected("notstyle")}
            className="w-full"
          >
            👎 Nicht mein Stil
          </Button>
        </div>
        <Textarea
          placeholder="Optionale Bemerkung..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-2"
        />
        <Button 
          onClick={handleSubmit} 
          disabled={!selected} 
          className="w-full"
          variant="hero"
        >
          Feedback senden
        </Button>
      </Card>
    </motion.div>
  );
}
