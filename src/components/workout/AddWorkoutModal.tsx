import { X, Loader2, Bot } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

  // Reset on every open: manual is the default, so reopening after a visit to
  // the KI tab starts on manual again rather than remembering the last tab.
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


  return (
    <>
      {/*
        Ported onto the shared Radix dialog primitive: it supplies role="dialog",
        aria-modal, the focus trap, Escape-to-close and focus return to the
        trigger. The previous hand-rolled overlay had none of those.
      */}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent
          className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-3xl border-primary/20 bg-background/95 backdrop-blur-xl [&>button]:h-11 [&>button]:w-11 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:bg-muted/80 [&>button]:opacity-100"
          style={{
            boxShadow: '0 0 40px rgba(16, 185, 129, 0.25), 0 8px 32px rgba(0, 0, 0, 0.12)',
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold text-center bg-gradient-to-r from-primary via-emerald-400 to-teal-400 bg-clip-text text-transparent">
              Training hinzufügen
            </DialogTitle>
            <DialogDescription className="sr-only">
              Füge Übungen zu diesem Trainingstag hinzu — manuell oder mit
              einem KI-Vorschlag.
            </DialogDescription>
          </DialogHeader>

          {/* Content */}
          <div className="relative">

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'ai' | 'manual')} className="w-full">
                    {/*
                      Manual is the primary action and comes first; the KI
                      suggestion is secondary. Labels are German, like the rest
                      of the app.
                    */}
                    <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50">
                      <TabsTrigger 
                        value="manual"
                        className="min-w-0 px-1.5 text-xs sm:px-3 sm:text-sm data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                      >
                        {/* The emoji is decoration; at 360px the label needs
                            the width more than the icon does. */}
                        <span className="mr-2 hidden sm:inline" aria-hidden="true">➕</span>
                        <span className="whitespace-nowrap">Manuell hinzufügen</span>
                      </TabsTrigger>
                      <TabsTrigger 
                        value="ai" 
                        className="min-w-0 px-1.5 text-xs sm:px-3 sm:text-sm data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                      >
                        <span className="mr-2 hidden sm:inline" aria-hidden="true">✨</span>
                        <span className="whitespace-nowrap">KI-Vorschlag</span>
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
        </DialogContent>
      </Dialog>

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
  );
}
