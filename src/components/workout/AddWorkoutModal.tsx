import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Bot } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { collection, getDocs, query, orderBy, limit, doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toastSuccess, toastError } from '@/lib/toastWithIcon';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ManualWorkoutForm } from './ManualWorkoutForm';
import { AIPromptAssist } from './AIPromptAssist';
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
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [hasExistingExercises, setHasExistingExercises] = useState(false);
  const { user } = useAuth();
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sync activeTab with mode prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(mode);
      setSuggestions([]);
      setError(null);
      setIsLoading(false);
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

  const handleAIGenerate = async (_prompt: string, _type: 'full-day' | 'single-workout') => {
    const message = 'KI-Funktionen sind während der Migration vorübergehend deaktiviert.';
    setError(message);
    toastError('KI vorübergehend nicht verfügbar', message);
    setIsLoading(false);
  };

  const handleAddWorkout = async (exercise: Exercise | WorkoutSuggestion) => {
    if (!dayContext || !user) return;

    try {
      // Get current workout plan from Firestore
      const plansRef = collection(db, 'users', user.uid, 'workout_plans');
      const planSnap = await getDocs(query(plansRef, orderBy('createdAt', 'desc'), limit(1)));
      if (planSnap.empty) {
        toastError('Fehler', 'Kein Trainingsplan gefunden');
        return;
      }
      const planDoc  = planSnap.docs[0];
      const planData = { id: planDoc.id, ...planDoc.data() } as any;

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
        sets: typeof exercise.sets === 'number' ? exercise.sets : parseInt(String(exercise.sets)) || 1,
        reps: typeof exercise.reps === 'number' ? exercise.reps.toString() : String(exercise.reps),
        rest: isWorkoutSuggestion ? '90s' : (exercise as Exercise).rest || '90s',
        weight: isWorkoutSuggestion ? '' : (exercise as Exercise).weight || '',
        description: exercise.description || ''
      });

      // Save updated plan
      await setDoc(doc(db, 'users', user.uid, 'workout_plans', planData.id),
        { content, updatedAt: Timestamp.now() }, { merge: true });

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

  const handleAddAllWorkouts = async (action?: 'replace' | 'add') => {
    if (!dayContext || !user) return;

    try {
      // Get current workout plan from Firestore
      const plansRef2 = collection(db, 'users', user.uid, 'workout_plans');
      const planSnap2 = await getDocs(query(plansRef2, orderBy('createdAt', 'desc'), limit(1)));
      if (planSnap2.empty) {
        toastError('Fehler', 'Kein Trainingsplan gefunden');
        return;
      }
      const planDoc2  = planSnap2.docs[0];
      const planData  = { id: planDoc2.id, ...planDoc2.data() } as any;

      const content = planData.content || {};
      
      // Ensure week exists
      if (!content[dayContext.weekKey]) {
        content[dayContext.weekKey] = Array(7).fill(null).map(() => ({ day: null, exercises: [] }));
      }

      const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

      // Ensure day exists
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

      // Check if day already has exercises
      const existingCount = dayData.exercises.length;
      if (existingCount > 0 && !action) {
        setHasExistingExercises(true);
        setShowConfirmDialog(true);
        return;
      }

      // Replace or add logic
      if (action === 'replace') {
        dayData.exercises = [];
      }

      // Add all suggestions
      const newExercises = suggestions.map(suggestion => ({
        name: suggestion.name,
        sets: typeof suggestion.sets === 'number' ? suggestion.sets : parseInt(String(suggestion.sets)) || 1,
        reps: typeof suggestion.reps === 'number' ? suggestion.reps.toString() : String(suggestion.reps),
        rest: '90s',
        weight: '',
        description: suggestion.description || ''
      }));

      dayData.exercises.push(...newExercises);

      // Save updated plan
      await setDoc(doc(db, 'users', user.uid, 'workout_plans', planData.id),
        { content, updatedAt: Timestamp.now() }, { merge: true });

      toastSuccess(
        'Tagesplan hinzugefügt!',
        `${suggestions.length} Übungen wurden ${action === 'replace' ? 'ersetzt' : 'hinzugefügt'}`
      );
      
      if (onWorkoutAdded) {
        onWorkoutAdded();
      }
      
      setShowConfirmDialog(false);
      onClose();
    } catch (err: any) {
      console.error('Error adding all workouts:', err);
      toastError('Fehler', 'Tagesplan konnte nicht hinzugefügt werden');
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
                className="relative bg-background/95 backdrop-blur-xl rounded-3xl border border-primary/20 overflow-visible"
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
                <div className="relative px-3 sm:px-4 py-4 sm:py-6 pt-8 pr-[max(0.75rem,env(safe-area-inset-right))] sm:pr-[max(1rem,env(safe-area-inset-right))]">
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

                     <ScrollArea className="h-[min(60vh,520px)] px-3 sm:px-4 pr-[max(0.75rem,env(safe-area-inset-right))] sm:pr-[max(1rem,env(safe-area-inset-right))] max-w-full overflow-x-hidden">
                      <TabsContent value="ai" className="mt-0">
                         <AIPromptAssist
                          dayContext={dayContext}
                          onGenerate={handleAIGenerate}
                          isLoading={isLoading}
                          suggestions={suggestions}
                          error={error}
                          onAddWorkout={handleAddWorkout}
                          onAddAllWorkouts={() => handleAddAllWorkouts()}
                        />
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
                    <div className="flex items-center justify-between gap-3 mt-6 pt-6 border-t border-border/50">
                      <Button
                        variant="ghost"
                        onClick={onClose}
                        className="hover:bg-muted/80 flex-shrink-0"
                      >
                        Abbrechen
                      </Button>
                      
                      {/* Show primary CTA only when suggestions are available */}
                      {suggestions.length > 0 && (
                        <Button
                          onClick={() => handleAddAllWorkouts()}
                          className="gradient-primary shadow-glow hover:shadow-glow-lg transition-all flex-1 min-w-0"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Wird hinzugefügt...
                            </>
                          ) : (
                            <>
                              <span className="mr-2">🟢</span>
                              <span className="truncate">Plan übernehmen</span>
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* Confirmation Dialog */}
          <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
            <AlertDialogContent className="bg-background/95 backdrop-blur-xl border-primary/20">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
                  Vorhandene Übungen gefunden
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  Dieser Tag enthält bereits Übungen. Möchtest du die neuen Vorschläge ersetzen oder hinzufügen?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="hover:bg-muted/80">
                  Abbrechen
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleAddAllWorkouts('add')}
                  className="bg-primary/20 text-primary hover:bg-primary/30"
                >
                  Hinzufügen
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => handleAddAllWorkouts('replace')}
                  className="gradient-primary shadow-glow"
                >
                  Ersetzen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </AnimatePresence>
  );
}
