import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Sparkles, Calendar, Dumbbell } from 'lucide-react';
import { InlineEditableText } from './InlineEditableText';
import { cn } from '@/lib/utils';
import { useWorkoutContext } from '@/hooks/useWorkoutContext';
import { AnimatedAvatar } from '@/components/ui/animated-avatar';

type AIState = 'idle' | 'thinking' | 'results' | 'applied';

interface WorkoutSuggestion {
  name: string;
  sets: number;
  reps: number | string;
  duration: number;
  description?: string;
}

interface AIPromptAssistProps {
  dayContext?: { weekKey: string; dayIndex: number };
  onGenerate: (prompt: string, type: 'full-day' | 'single-workout') => void;
  isLoading: boolean;
  suggestions: WorkoutSuggestion[];
  error: string | null;
  onAddWorkout: (suggestion: WorkoutSuggestion) => void;
  onAddAllWorkouts?: () => void;
}

const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function AIPromptAssist({
  dayContext,
  onGenerate,
  isLoading,
  suggestions,
  error,
  onAddWorkout,
  onAddAllWorkouts
}: AIPromptAssistProps) {
  const [step, setStep] = useState<'select' | 'prompt' | 'results'>('select');
  const [selectedType, setSelectedType] = useState<'full-day' | 'single-workout' | null>(null);
  const [duration, setDuration] = useState('45');
  const [focus, setFocus] = useState('Full-Body');
  const [intensity, setIntensity] = useState('Kraft & Core');
  const [isSuccess, setIsSuccess] = useState(false);
  const [aiState, setAiState] = useState<AIState>('idle');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const workoutContext = useWorkoutContext();

  // Update aiState based on loading and suggestions
  useEffect(() => {
    if (isLoading) {
      setAiState('thinking');
    } else if (suggestions.length > 0) {
      setAiState('results');
    } else if (isSuccess) {
      setAiState('applied');
    } else {
      setAiState('idle');
    }
  }, [isLoading, suggestions.length, isSuccess]);

  // Reset to select when suggestions come in
  useEffect(() => {
    if (suggestions.length > 0) {
      setStep('results');
    }
  }, [suggestions]);

  // Reset to select when error occurs
  useEffect(() => {
    if (error) {
      setStep('select');
    }
  }, [error]);

  const handleSelectType = (type: 'full-day' | 'single-workout') => {
    setSelectedType(type);
    setStep('prompt');
  };

  const handleGenerate = () => {
    if (!selectedType) return;
    
    const dayOfWeek = dayContext ? dayNames[dayContext.dayIndex] : 'Wochentag';
    
    // Build context-aware prompt
    let basePrompt = selectedType === 'full-day'
      ? `Erstelle einen kompletten Trainingsplan für ${dayOfWeek} mit ${duration} Minuten Gesamtzeit. Fokus: ${focus}. Intensität: ${intensity}.`
      : `Erstelle ein einzelnes ${duration}-minütiges ${focus}-Workout für ${dayOfWeek}. Fokus: ${intensity}.`;
    
    // Enhance with workout context
    const contextAdditions: string[] = [];
    
    if (workoutContext.streak >= 3) {
      contextAdditions.push('Der Nutzer ist seit mehreren Tagen aktiv – füge eine kurze motivierende Nachricht hinzu.');
    }
    
    if (workoutContext.lastWorkoutType === 'HighIntensity' && workoutContext.recoveryDays === 0) {
      contextAdditions.push('Das letzte Training war hochintensiv – halte das heutige Training moderat oder fokussiere auf aktive Erholung.');
    }
    
    if (workoutContext.recentFocus.length > 0) {
      contextAdditions.push(`Berücksichtige, dass kürzlich diese Bereiche trainiert wurden: ${workoutContext.recentFocus.join(', ')}.`);
    }
    
    if (workoutContext.recoveryDays >= 2) {
      contextAdditions.push('Es gab eine längere Pause – wähle ein sanftes Wiedereinstiegstraining.');
    }
    
    const fullPrompt = contextAdditions.length > 0 
      ? `${basePrompt}\n\nKontext: ${contextAdditions.join(' ')}`
      : basePrompt;
    
    onGenerate(fullPrompt, selectedType);
  };

  const handleReset = () => {
    setStep('select');
    setSelectedType(null);
    setIsSuccess(false);
    setAiState('idle');
  };

  const handleAddAllWorkoutsWithFeedback = async () => {
    if (onAddAllWorkouts) {
      setAiState('applied');
      await onAddAllWorkouts();
      setIsSuccess(true);
      
      // Reset success state after animation completes
      setTimeout(() => {
        setIsSuccess(false);
        handleReset();
      }, 2400);
    }
  };

  const cardVariants = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 }
      };

  return (
    <div className="space-y-6">
      {/* AI State Indicator Header */}
      <motion.div 
        className="flex items-center justify-center gap-3 py-2"
        animate={{
          opacity: aiState === 'idle' ? 0 : 1,
        }}
        transition={{ duration: 0.3 }}
      >
        <AnimatedAvatar
          isThinking={aiState === 'thinking'}
          fallback="AI"
          className="w-10 h-10"
        />
        <motion.div
          className="text-sm font-medium"
          animate={{
            color: aiState === 'thinking' 
              ? 'rgb(14, 165, 233)' 
              : aiState === 'results' || aiState === 'applied'
              ? 'rgb(16, 185, 129)'
              : 'rgb(156, 163, 175)',
          }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          {aiState === 'thinking' && 'Denke nach...'}
          {aiState === 'results' && 'Vorschläge bereit'}
          {aiState === 'applied' && 'Erfolgreich übernommen'}
        </motion.div>
      </motion.div>

      <AnimatePresence mode="wait">
        {/* Step 1: Selection Cards */}
        {step === 'select' && (
          <motion.div
            key="select"
            {...cardVariants}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Was möchtest du generieren?
              </h3>
              <p className="text-sm text-muted-foreground">
                Wähle zwischen Tagesplan oder einzelnem Workout
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Full Day Card */}
              <motion.button
                onClick={() => handleSelectType('full-day')}
                className={cn(
                  "relative p-6 rounded-2xl border-2 text-left",
                  "bg-gradient-to-br from-primary/5 to-primary/10",
                  "border-primary/30 hover:border-primary/50",
                  "hover:shadow-glow transition-all",
                  "group"
                )}
                whileHover={prefersReducedMotion ? {} : { scale: 1.02, y: -4 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
              >
                <div className="flex flex-col items-center text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Calendar className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">
                      🎯 Für den ganzen Tag
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Kompletter Tagesplan mit mehreren Workouts
                    </p>
                  </div>
                </div>
              </motion.button>

              {/* Single Workout Card */}
              <motion.button
                onClick={() => handleSelectType('single-workout')}
                className={cn(
                  "relative p-6 rounded-2xl border-2 text-left",
                  "bg-gradient-to-br from-emerald-500/5 to-teal-500/10",
                  "border-emerald-500/30 hover:border-emerald-500/50",
                  "hover:shadow-glow transition-all",
                  "group"
                )}
                whileHover={prefersReducedMotion ? {} : { scale: 1.02, y: -4 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
              >
                <div className="flex flex-col items-center text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Dumbbell className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1">
                      🏋️ Einzelnes Workout
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Ein fokussiertes Training für heute
                    </p>
                  </div>
                </div>
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Step 2: Prompt Assist Box */}
        {step === 'prompt' && !isLoading && (
          <motion.div
            key="prompt"
            {...cardVariants}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Passe deinen Prompt an
              </h3>
              <p className="text-sm text-muted-foreground">
                Klicke auf die markierten Teile um sie zu bearbeiten
              </p>
            </div>

            <div className="bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/30 rounded-2xl p-6">
              <div className="flex items-start gap-3 mb-4">
                <motion.div 
                  className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"
                  animate={{
                    backgroundColor: aiState === 'thinking' 
                      ? 'rgba(14, 165, 233, 0.2)' 
                      : 'rgba(var(--primary), 0.2)',
                  }}
                  transition={{ duration: 0.8, ease: 'easeInOut' }}
                >
                  <Sparkles className="w-5 h-5 text-primary" />
                </motion.div>
                <div className="flex-1">
                  <p className="text-sm text-foreground leading-relaxed">
                    {selectedType === 'full-day' ? (
                      <>
                        Erstelle einen kompletten Trainingsplan für{' '}
                        <span className="font-semibold text-primary">
                          {dayContext ? dayNames[dayContext.dayIndex] : 'Wochentag'}
                        </span>
                        {' '}mit{' '}
                        <InlineEditableText
                          value={duration}
                          onChange={setDuration}
                          placeholder="45"
                        />
                        {' '}Minuten Gesamtzeit.
                        <br />
                        Fokus:{' '}
                        <InlineEditableText
                          value={focus}
                          onChange={setFocus}
                          placeholder="Full-Body"
                        />
                        .{' '}
                        Intensität:{' '}
                        <InlineEditableText
                          value={intensity}
                          onChange={setIntensity}
                          placeholder="Kraft & Core"
                        />
                        .
                      </>
                    ) : (
                      <>
                        Erstelle ein einzelnes{' '}
                        <InlineEditableText
                          value={duration}
                          onChange={setDuration}
                          placeholder="45"
                        />
                        -minütiges{' '}
                        <InlineEditableText
                          value={focus}
                          onChange={setFocus}
                          placeholder="Full-Body"
                        />
                        -Workout für{' '}
                        <span className="font-semibold text-primary">
                          {dayContext ? dayNames[dayContext.dayIndex] : 'Wochentag'}
                        </span>
                        .
                        <br />
                        Fokus:{' '}
                        <InlineEditableText
                          value={intensity}
                          onChange={setIntensity}
                          placeholder="Kraft & Core"
                        />
                        .
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleReset}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                >
                  <RefreshCw className="w-3 h-3 mr-2" />
                  Neu wählen
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <Button
                onClick={handleReset}
                variant="ghost"
              >
                Zurück
              </Button>
              <Button
                onClick={handleGenerate}
                className="gradient-primary shadow-glow"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generieren
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Loading State */}
        {isLoading && (
          <motion.div
            key="loading"
            {...cardVariants}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center py-16 space-y-4"
          >
            <motion.div
              className="relative"
              animate={{
                rotate: 360,
              }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <motion.div
                className="absolute inset-0 rounded-full blur-lg"
                animate={{
                  backgroundColor: [
                    'rgba(14, 165, 233, 0.3)',
                    'rgba(14, 165, 233, 0.5)',
                    'rgba(14, 165, 233, 0.3)',
                  ],
                  scale: [1, 1.2, 1],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <Loader2 className="h-12 w-12 text-sky-500 relative z-10" />
            </motion.div>
            <div className="text-center">
              <motion.p 
                className="text-lg font-medium mb-1"
                animate={{
                  color: ['rgb(14, 165, 233)', 'rgb(56, 189, 248)', 'rgb(14, 165, 233)'],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                Denke nach...
              </motion.p>
              <p className="text-sm text-muted-foreground">
                KI generiert personalisierte Vorschläge
              </p>
            </div>
          </motion.div>
        )}

        {/* Step 4: Results */}
        {step === 'results' && suggestions.length > 0 && (
          <motion.div
            key="results"
            {...cardVariants}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Vorschläge
              </h3>
              <Button
                onClick={handleReset}
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                Neu generieren
              </Button>
            </div>

            <div className="space-y-3">
              {suggestions.map((suggestion, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ 
                    opacity: 1, 
                    y: 0, 
                    scale: 1,
                    filter: [
                      'drop-shadow(0 0 0px rgba(16, 185, 129, 0))',
                      'drop-shadow(0 0 10px rgba(16, 185, 129, 0.3))',
                      'drop-shadow(0 0 0px rgba(16, 185, 129, 0))',
                    ]
                  }}
                  transition={{ 
                    delay: idx * 0.1,
                    duration: 0.6,
                    filter: { duration: 1.2, times: [0, 0.5, 1] }
                  }}
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
                  {/* Only show individual add button for single workout mode */}
                  {selectedType === 'single-workout' && (
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
                        onClick={() => onAddWorkout(suggestion)}
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                      >
                        Zu Tag hinzufügen
                      </Button>
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Global button for full-day generation */}
            {selectedType === 'full-day' && onAddAllWorkouts && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: suggestions.length * 0.1 + 0.2 }}
                className="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-background via-background to-transparent"
              >
                <motion.div
                  animate={
                    isSuccess && !prefersReducedMotion
                      ? {
                          opacity: [1, 0.7, 1],
                          scale: [1, 1.04, 1],
                        }
                      : {}
                  }
                  transition={
                    isSuccess && !prefersReducedMotion
                      ? {
                          duration: 1.2,
                          repeat: 2,
                          ease: "easeInOut",
                        }
                      : {}
                  }
                >
                  <Button
                    onClick={handleAddAllWorkoutsWithFeedback}
                    disabled={isSuccess}
                    className="w-full gradient-primary shadow-glow hover:shadow-glow-lg transition-all"
                    size="lg"
                  >
                    {isSuccess ? (
                      <>
                        <span className="mr-2">✅</span>
                        Übernommen
                      </>
                    ) : (
                      <>
                        <span className="mr-2">🟢</span>
                        Plan für den ganzen Tag übernehmen
                      </>
                    )}
                  </Button>
                </motion.div>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Error State */}
        {error && step === 'select' && (
          <motion.div
            key="error"
            {...cardVariants}
            transition={{ duration: 0.3 }}
            className="bg-primary/10 border border-primary/20 rounded-2xl p-6 text-center"
          >
            <p className="text-sm text-muted-foreground">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
