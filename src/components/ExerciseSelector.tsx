import React, { useState, useEffect, useRef } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// Predefined exercises with their types
export const PREDEFINED_EXERCISES = [
  // Cardio
  { name: 'Laufen', type: 'cardio', icon: '🏃' },
  { name: 'Radfahren', type: 'cardio', icon: '🚴' },
  { name: 'Schwimmen', type: 'cardio', icon: '🏊' },
  { name: 'Rudern', type: 'cardio', icon: '🚣' },
  
  // Upper Body - Push
  { name: 'Bankdrücken', type: 'strength', icon: '💪' },
  { name: 'Schrägbankdrücken', type: 'strength', icon: '💪' },
  { name: 'Schulterdrücken', type: 'strength', icon: '💪' },
  { name: 'Liegestütze', type: 'strength', icon: '💪' },
  { name: 'Dips', type: 'strength', icon: '💪' },
  
  // Upper Body - Pull
  { name: 'Klimmzüge', type: 'strength', icon: '💪' },
  { name: 'Latziehen', type: 'strength', icon: '💪' },
  { name: 'Rudern', type: 'strength', icon: '💪' },
  { name: 'Bizepscurls', type: 'strength', icon: '💪' },
  
  // Lower Body
  { name: 'Kniebeugen', type: 'strength', icon: '🦵' },
  { name: 'Kreuzheben', type: 'strength', icon: '🦵' },
  { name: 'Beinpresse', type: 'strength', icon: '🦵' },
  { name: 'Ausfallschritte', type: 'strength', icon: '🦵' },
  { name: 'Beinbeuger', type: 'strength', icon: '🦵' },
  { name: 'Beinstrecker', type: 'strength', icon: '🦵' },
  { name: 'Wadenheben', type: 'strength', icon: '🦵' },
  
  // Core
  { name: 'Planks', type: 'strength', icon: '🧘' },
  { name: 'Crunches', type: 'strength', icon: '🧘' },
  { name: 'Russian Twists', type: 'strength', icon: '🧘' },
] as const;

interface ExerciseSelectorProps {
  onSelect: (exercise: typeof PREDEFINED_EXERCISES[number]) => void;
  currentExercise?: typeof PREDEFINED_EXERCISES[number] | null;
  className?: string;
}

export const ExerciseSelector: React.FC<ExerciseSelectorProps> = ({
  onSelect,
  currentExercise,
  className,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedTab, setSelectedTab] = useState<'strength' | 'cardio' | 'core'>('strength');
  const [highlightedExercise, setHighlightedExercise] = useState<string | null>(null);
  const exerciseRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Set initial tab based on current exercise type
  useEffect(() => {
    if (currentExercise) {
      const tabMap: Record<string, 'strength' | 'cardio' | 'core'> = {
        'cardio': 'cardio',
        'strength': currentExercise.icon === '🧘' ? 'core' : 'strength',
      };
      setSelectedTab(tabMap[currentExercise.type] || 'strength');
      
      // Highlight and scroll after a short delay to ensure DOM is ready
      setTimeout(() => {
        setHighlightedExercise(currentExercise.name);
        exerciseRefs.current[currentExercise.name]?.scrollIntoView({ 
          block: 'center', 
          behavior: 'smooth' 
        });
        
        // Remove highlight after 1 second
        setTimeout(() => setHighlightedExercise(null), 1000);
      }, 100);
    }
  }, [currentExercise]);

  const hasSearch = searchValue.trim().length > 0;
  let exercises = [...PREDEFINED_EXERCISES];
  
  // If no search, filter by selected tab
  if (!hasSearch) {
    if (selectedTab === 'cardio') {
      exercises = exercises.filter(ex => ex.type === 'cardio');
    } else if (selectedTab === 'core') {
      exercises = exercises.filter(ex => ex.icon === '🧘');
    } else {
      exercises = exercises.filter(ex => ex.type === 'strength' && ex.icon !== '🧘');
    }
  }
  
  // Group by category
  const cardio = exercises.filter(ex => ex.type === 'cardio');
  const strength = exercises.filter(ex => ex.type === 'strength');

  return (
    <div className={cn("space-y-3", className)}>
      <Command className="rounded-lg border">
        <CommandInput 
          placeholder="Übung suchen..." 
          value={searchValue}
          onValueChange={setSearchValue}
          autoFocus={false}
        />
      </Command>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as 'strength' | 'cardio' | 'core')}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="strength">💪 Strength</TabsTrigger>
          <TabsTrigger value="cardio">🏃 Cardio</TabsTrigger>
          <TabsTrigger value="core">🧘 Core</TabsTrigger>
        </TabsList>
      </Tabs>
      
      <Command className="rounded-lg border">
        <CommandList>
          <CommandEmpty>Keine Übung gefunden.</CommandEmpty>
          
          {cardio.length > 0 && (
            <CommandGroup heading="Cardio">
              {cardio.map((exercise) => (
                <CommandItem
                  key={exercise.name}
                  value={exercise.name}
                  onSelect={() => onSelect(exercise)}
                  ref={(el) => exerciseRefs.current[exercise.name] = el}
                  className={cn(
                    "cursor-pointer",
                    highlightedExercise === exercise.name && "animate-pulse bg-emerald-500/10"
                  )}
                >
                  <span className="mr-2 text-lg">{exercise.icon}</span>
                  <span>{exercise.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          
          {strength.length > 0 && (
            <CommandGroup heading="Krafttraining">
              {strength.map((exercise) => (
                <CommandItem
                  key={exercise.name}
                  value={exercise.name}
                  onSelect={() => onSelect(exercise)}
                  ref={(el) => exerciseRefs.current[exercise.name] = el}
                  className={cn(
                    "cursor-pointer",
                    highlightedExercise === exercise.name && "animate-pulse bg-emerald-500/10"
                  )}
                >
                  <span className="mr-2 text-lg">{exercise.icon}</span>
                  <span>{exercise.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );
};
