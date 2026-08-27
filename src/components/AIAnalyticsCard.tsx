import { motion, useReducedMotion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AI usage statistics — deliberately unavailable.
 *
 * This card used to read `users/{uid}/ai_logs`, a collection the client owns
 * and nothing has ever written. From PR55 the authoritative record lives in
 * `_ai_logs`, which is denied to every client on purpose: a log of what was
 * spent is worthless if the person it bills can rewrite it, and relaxing that
 * to power a chart would trade a real control for a decoration.
 *
 * So the card shows no numbers rather than zeros. After generating three plans
 * a user would have read "0 erfolgreich" — not an empty state but a false
 * statement about their own usage. A server-side aggregate could power this
 * honestly later; until it exists, this says so.
 */
export const AIAnalyticsCard = () => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className={cn(
        'relative overflow-hidden rounded-3xl p-5',
        'bg-muted/30 ring-1 ring-border/50'
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-muted/60 p-2.5 shrink-0">
          <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            Nutzungsstatistik noch nicht verfügbar
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Deine erstellten Trainingspläne findest du im Trainingsbereich.
            Eine Auswertung deiner Nutzung gibt es hier noch nicht.
          </p>
        </div>
      </div>
    </motion.div>
  );
};
