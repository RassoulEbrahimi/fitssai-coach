import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Bot } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toastSuccess, toastError } from '@/lib/toastWithIcon';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ManualWorkoutForm } from './ManualWorkoutForm';
import type { Exercise } from '@/hooks/useExerciseEditor';

interface WorkoutSuggestion {
  name: string;
  sets: number;
  reps: number | string;
  duration: number;
  description?: string;
}

interface AddWorkoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'ai' | 'manual';
  dayContext?: { weekKey: string; dayIndex: number };
  onWorkoutAdded?: () => void;
}

export function AddWorkoutModal({ 
  isOpen, 
  onClose, 
  mode = 'manual',
  dayContext,
  onWorkoutAdded
}: AddWorkoutModalProps) {
  const [activeTab, setActiveTab] = useState(mode);
  const [suggestions, setSuggestions] = useState<WorkoutSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  // Fetch AI suggestions when AI tab is opened (with debounce and abort controller)
  useEffect(() => {
    if (isOpen && activeTab === 'ai' && dayContext && user) {
      const abortController = new AbortController();
      
      // Debounce to prevent rapid calls
      const timeoutId = setTimeout(() => {
        console.log('[AI Suggestions] Fetching with abort signal');
        fetchSuggestions(abortController.signal);
      }, 400);

      // Cleanup: cancel timeout and abort request
      return () => {
        clearTimeout(timeoutId);
        if (!abortController.signal.aborted) {
          console.log('[AI Suggestions] Request aborted due to tab switch or modal close');
          abortController.abort();
        }
      };
    }
  }, [isOpen, activeTab, dayContext, user]);

  // Sync activeTab with mode prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(mode);
      setSuggestions([]);
      setError(null);
    }
  }, [isOpen, mode]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const fetchSuggestions = async (signal?: AbortSignal) => {
    if (!dayContext) return;
    
    setIsLoading(true);
    setError(null);

    try {
      const dayOfWeek = dayNames[dayContext.dayIndex] || 'Wochentag';
      
      // Check if already aborted before making the request
      if (signal?.aborted) {
        console.log('[AI Suggestions] Fetch cancelled before request');
        return;
      }

    const { data, error } = await supabase.functions.invoke('generate-day-suggestions', {
      body: {
        day_of_week: dayOfWeek,
        available_time: 45
      }
    });

    if (error) {
      console.error('Detailed error:', error);
      
      // Try to extract JSON error details from the error response
      let errorDetails = null;
      try {
        // Check if error has context with response body
        if (error.context?.body) {
          errorDetails = typeof error.context.body === 'string' 
            ? JSON.parse(error.context.body) 
            : error.context.body;
        }
      } catch (parseErr) {
        console.log('[AI Suggestions] Could not parse error body:', parseErr);
      }

      // If we have structured error details, handle them
      if (errorDetails?.code) {
        let userMessage = errorDetails.error;
        
        switch (errorDetails.code) {
          case 'OPENAI_KEY_MISSING':
            userMessage = 'Der KI-Dienst ist nicht eingerichtet. Bitte kontaktiere den Support.';
            break;
          case 'UNAUTHORIZED':
            userMessage = 'Sitzung abgelaufen. Bitte neu anmelden.';
            break;
          case 'PROFILE_NOT_FOUND':
            userMessage = 'Dein Profil ist unvollständig. Bitte vervollständige deine Daten.';
            break;
          case 'RATE_LIMIT_OR_QUOTA_EXCEEDED':
            userMessage = 'KI-Dienst vorübergehend nicht verfügbar. Bitte später erneut versuchen.';
            break;
          case 'GENERATION_FAILED':
            userMessage = `Fehler beim Generieren: ${errorDetails.details || errorDetails.error}`;
            break;
        }
        
        setError(userMessage);
        toastError('Fehler', userMessage);
        return;
      }
      
      throw error;
    }

    // Check for backend error response in data
    if (data?.error) {
      console.error('Backend error:', data);
      const errorCode = data.code;
      let userMessage = data.error;
      
      // Map error codes to user-friendly messages
      switch (errorCode) {
        case 'OPENAI_KEY_MISSING':
          userMessage = 'Der KI-Dienst ist nicht eingerichtet. Bitte kontaktiere den Support.';
          break;
        case 'UNAUTHORIZED':
          userMessage = 'Sitzung abgelaufen. Bitte neu anmelden.';
          break;
        case 'PROFILE_NOT_FOUND':
          userMessage = 'Dein Profil ist unvollständig. Bitte vervollständige deine Daten.';
          break;
        case 'RATE_LIMIT_OR_QUOTA_EXCEEDED':
          userMessage = 'KI-Dienst vorübergehend nicht verfügbar. Bitte später erneut versuchen.';
          break;
        case 'GENERATION_FAILED':
          userMessage = `Fehler beim Generieren: ${data.details || data.error}`;
          break;
      }
      
      setError(userMessage);
      toastError('Fehler', userMessage);
      return;
    }

      if (data?.suggestions) {
        setSuggestions(data.suggestions);
      } else {
        throw new Error('Keine Vorschläge erhalten');
      }
    } catch (err: any) {
      // Check if error is due to abort
      if (signal?.aborted || err.name === 'AbortError') {
        console.log('[AI Suggestions] Fetch cancelled due to tab switch');
        return;
      }
      
      console.error('Detailed error:', err);
      const errorMessage = err.message || 'Fehler beim Laden der Vorschläge';
      setError(errorMessage);
      toastError('Fehler', errorMessage);
    } finally {
      // Only clear loading if not aborted
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  };

  const handleAddWorkout = async (exercise: Exercise | WorkoutSuggestion) => {
    if (!dayContext || !user) return;

    try {
      // Get current workout plan
      const { data: planData } = await supabase
        .from('workout_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!planData) {
        toastError('Fehler', 'Kein Trainingsplan gefunden');
        return;
      }

      // Update workout plan content
      const content = planData.content || {};
      
      // Ensure week exists
      if (!content[dayContext.weekKey]) {
        content[dayContext.weekKey] = Array(7).fill(null).map(() => ({ day: null, exercises: [] }));
      }

      // Get day names for proper initialization
      const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

      // Ensure day exists and is properly initialized (handle rest days)
      if (!content[dayContext.weekKey][dayContext.dayIndex] || 
          typeof content[dayContext.weekKey][dayContext.dayIndex] !== 'object') {
        content[dayContext.weekKey][dayContext.dayIndex] = {
          day: dayNames[dayContext.dayIndex],
          exercises: []
        };
      }

      const dayData = content[dayContext.weekKey][dayContext.dayIndex];
      
      // Ensure exercises array exists
      if (!dayData.exercises || !Array.isArray(dayData.exercises)) {
        dayData.exercises = [];
      }

      // Check if it's a WorkoutSuggestion (has duration property) or Exercise
      const isWorkoutSuggestion = 'duration' in exercise;

      // Add new exercise - handle both Exercise and WorkoutSuggestion types
      dayData.exercises.push({
        name: exercise.name,
        sets: typeof exercise.sets === 'number' ? exercise.sets.toString() : String(exercise.sets),
        reps: typeof exercise.reps === 'number' ? exercise.reps.toString() : String(exercise.reps),
        rest: isWorkoutSuggestion ? '90s' : (exercise as Exercise).rest || '90s',
        weight: isWorkoutSuggestion ? '' : (exercise as Exercise).weight || '',
        description: exercise.description || ''
      });

      // Save updated plan
      const { error: updateError } = await supabase
        .from('workout_plans')
        .update({ content })
        .eq('id', planData.id);

      if (updateError) throw updateError;

      toastSuccess('Hinzugefügt', `${exercise.name} wurde zu deinem Training hinzugefügt`);
      
      if (onWorkoutAdded) {
        onWorkoutAdded();
      }
      
      onClose();
    } catch (err: any) {
      console.error('Error adding workout:', err);
      toastError('Fehler', 'Training konnte nicht hinzugefügt werden');
    }
  };

  const modalVariants = prefersReducedMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1 }
      }
    : {
        hidden: { opacity: 0, scale: 0.95 },
        visible: { opacity: 1, scale: 1 }
      };

  const overlayVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              className="relative w-full max-w-2xl pointer-events-auto"
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={prefersReducedMotion ? { duration: 0.15 } : { duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              {/* Glass container */}
              <div
                className="relative bg-background/95 backdrop-blur-xl rounded-3xl border border-primary/20 overflow-hidden"
                style={{
                  boxShadow: '0 0 40px rgba(16, 185, 129, 0.25), 0 8px 32px rgba(0, 0, 0, 0.12)',
                  willChange: 'transform, opacity'
                }}
              >
                {/* Decorative glow elements */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div
                    className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 rounded-full blur-3xl"
                    style={{ willChange: 'transform' }}
                  />
                  <div
                    className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl"
                    style={{ willChange: 'transform' }}
                  />
                </div>

                {/* Close button */}
                <motion.button
                  className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-muted/80 hover:bg-muted flex items-center justify-center transition-colors"
                  onClick={onClose}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                  transition={{ duration: 0.1 }}
                  aria-label="Modal schließen"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </motion.button>

                {/* Content */}
                <div className="relative p-6 pt-8">
                  <h2 className="text-2xl font-semibold mb-6 text-center bg-gradient-to-r from-primary via-emerald-400 to-teal-400 bg-clip-text text-transparent">
                    Training hinzufügen
                  </h2>

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'ai' | 'manual')} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50">
                      <TabsTrigger 
                        value="ai" 
                        className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                      >
                        <span className="mr-2">✨</span>
                        AI Suggestion
                      </TabsTrigger>
                      <TabsTrigger 
                        value="manual"
                        className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                      >
                        <span className="mr-2">➕</span>
                        Manual Add
                      </TabsTrigger>
                    </TabsList>

                    <ScrollArea className="h-[400px] pr-4">
                      <TabsContent value="ai" className="mt-0">
                        {isLoading ? (
                          <div className="flex flex-col items-center justify-center h-full py-16">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                              className="mb-4"
                            >
                              <Loader2 className="h-12 w-12 text-primary" />
                            </motion.div>
                            <p className="text-muted-foreground">Personalisierte Vorschläge werden generiert...</p>
                          </div>
                        ) : error ? (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center justify-center bg-primary/10 border border-primary/20 rounded-2xl p-8 text-center space-y-4"
                          >
                            <Bot className="w-12 h-12 text-primary" />
                            <h3 className="text-lg font-semibold text-foreground">
                              KI-Dienst momentan nicht verfügbar
                            </h3>
                            <p className="text-sm text-muted-foreground max-w-md">
                              {error}
                            </p>
                            <Button
                              onClick={() => fetchSuggestions()}
                              variant="outline"
                              className="mt-2 border-primary/30 hover:bg-primary/20"
                            >
                              Später erneut versuchen
                            </Button>
                          </motion.div>
                        ) : suggestions.length > 0 ? (
                          <div className="space-y-3">
                            {suggestions.map((suggestion, idx) => (
                              <motion.div
                                key={idx}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.1 }}
                                whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                                className="p-4 rounded-2xl bg-primary/10 border border-primary/30 backdrop-blur-xl"
                              >
                                <div className="flex justify-between items-start mb-2">
                                  <span className="font-semibold text-primary">{suggestion.name}</span>
                                  <span className="text-xs text-primary/70">{suggestion.duration} min</span>
                                </div>
                                <p className="text-xs text-muted-foreground mb-2">
                                  {suggestion.sets} Sätze × {suggestion.reps} Wdh.
                                </p>
                                {suggestion.description && (
                                  <p className="text-xs text-muted-foreground/80 mb-3 italic">
                                    {suggestion.description}
                                  </p>
                                )}
                                <motion.div
                                  whileTap={
                                    prefersReducedMotion
                                      ? {}
                                      : {
                                          scale: [1, 1.05, 1],
                                          filter: [
                                            "drop-shadow(0 0 0px rgba(0, 255, 156, 0))",
                                            "drop-shadow(0 0 14px rgba(0, 255, 156, 0.4))",
                                            "drop-shadow(0 0 0px rgba(0, 255, 156, 0))"
                                          ]
                                        }
                                  }
                                  transition={{ duration: 0.35, ease: "easeOut" }}
                                >
                                  <Button
                                    onClick={() => handleAddWorkout(suggestion)}
                                    variant="outline"
                                    size="sm"
                                    className="w-full text-xs"
                                  >
                                    Zu Tag hinzufügen
                                  </Button>
                                </motion.div>
                              </motion.div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                            <div className="text-6xl mb-4">✨</div>
                            <p className="text-lg text-muted-foreground">
                              Bereit für personalisierte Vorschläge
                            </p>
                            <p className="text-sm text-muted-foreground/70 mt-2">
                              Lass die KI dein perfektes Training planen
                            </p>
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="manual" className="mt-0">
                        <ManualWorkoutForm
                          onSave={handleAddWorkout}
                          onCancel={onClose}
                        />
                      </TabsContent>
                    </ScrollArea>
                  </Tabs>

                  {/* Footer buttons - Only for AI tab */}
                  {activeTab === 'ai' && (
                    <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-border/50">
                      <Button
                        variant="ghost"
                        onClick={onClose}
                        className="hover:bg-muted/80"
                      >
                        Abbrechen
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
