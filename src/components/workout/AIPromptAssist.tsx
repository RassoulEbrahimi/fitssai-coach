import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Sparkles, Calendar, Dumbbell } from 'lucide-react';
import { InlineEditableText } from './InlineEditableText';
import { cn } from '@/lib/utils';

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
}

const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function AIPromptAssist({
  dayContext,
  onGenerate,
  isLoading,
  suggestions,
  error,
  onAddWorkout
}: AIPromptAssistProps) {
  const [step, setStep] = useState<'select' | 'prompt' | 'results'>('select');
  const [selectedType, setSelectedType] = useState<'full-day' | 'single-workout' | null>(null);
  const [duration, setDuration] = useState('45');
  const [focus, setFocus] = useState('Full-Body');
  const [intensity, setIntensity] = useState('Kraft & Core');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    const prompt = selectedType === 'full-day'
      ? `Erstelle einen kompletten Trainingsplan für ${dayOfWeek} mit ${duration} Minuten Gesamtzeit. Fokus: ${focus}. Intensität: ${intensity}.`
      : `Erstelle ein einzelnes ${duration}-minütiges ${focus}-Workout für ${dayOfWeek}. Fokus: ${intensity}.`;
    
    onGenerate(prompt, selectedType);
  };

  const handleReset = () => {
    setStep('select');
    setSelectedType(null);
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
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
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
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="h-12 w-12 text-primary" />
            </motion.div>
            <div className="text-center">
              <p className="text-lg font-medium text-foreground mb-1">Denke nach...</p>
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
                      onClick={() => onAddWorkout(suggestion)}
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
