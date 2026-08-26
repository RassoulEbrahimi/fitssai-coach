import { motion } from 'framer-motion';
import { Sparkles, Info } from 'lucide-react';

/**
 * Placeholder for the not-yet-built KI suggestion feature.
 *
 * This file used to hold an 823-line generation flow: focus pickers, a prompt
 * form, an "analysing your training" step on a 1.8s timer, and a success
 * overlay. None of it could succeed — `handleAIGenerate` threw
 * `AI_UNAVAILABLE` on its first line, so every path ended in an error toast
 * after the animation had finished playing. The simulation is gone; what
 * remains states plainly that the feature does not exist yet.
 *
 * There is no provider, no backend and no generation in this build. When one
 * arrives, this component is where the real flow goes.
 */
export function AIPromptAssist() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="py-8 px-2 text-center space-y-4"
            role="status"
        >
            <div className="flex justify-center">
                <div className="rounded-2xl bg-muted/60 p-3">
                    <Sparkles className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-base font-semibold text-foreground">
                    KI-Vorschläge sind noch nicht verfügbar
                </h3>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground leading-relaxed">
                    Diese Funktion ist in Arbeit. Sobald sie bereitsteht, kannst du dir hier
                    Übungen für deinen Trainingstag vorschlagen lassen.
                </p>
            </div>

            <div className="mx-auto flex max-w-sm items-start gap-2 rounded-xl bg-muted/40 p-3 text-left">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Nutze so lange „Manuell hinzufügen“ — damit legst du Übungen direkt an.
                </p>
            </div>
        </motion.div>
    );
}
