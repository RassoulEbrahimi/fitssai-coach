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
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2 } from 'lucide-react';
import {
  EXERCISE_CATEGORIES,
  classifyExercise,
  type ExerciseCategory,
} from '@/lib/exerciseCategories';

// Type for exercise from database
export interface DatabaseExercise {
  id: string;
  name: string;
  target_muscle: string;
  category: string;
  type: 'strength' | 'cardio';
  icon: string;
}

// Map target muscles to icons
const muscleToIcon: Record<string, string> = {
  'Chest': '💪',
  'Back': '🦴',
  'Legs': '🦵',
  'Shoulders': '💪',
  'Triceps': '💪',
  'Biceps': '💪',
  'Abs': '🧘',
};

interface ExerciseSelectorProps {
  onSelect: (exercise: DatabaseExercise) => void;
  currentExercise?: DatabaseExercise | null;
  className?: string;
}

export const ExerciseSelector: React.FC<ExerciseSelectorProps> = ({
  onSelect,
  currentExercise,
  className,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedTab, setSelectedTab] = useState<ExerciseCategory>('push');
  const [highlightedExercise, setHighlightedExercise] = useState<string | null>(null);
  const [exercises, setExercises] = useState<DatabaseExercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const exerciseRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Fetch exercises from database
  useEffect(() => {
    const fetchExercises = async () => {
      setIsLoading(true);
      try {
        const exRef = collection(db, 'exercises');
        const snap = await getDocs(query(exRef, orderBy('name')));
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Transform database exercises to include type and icon
        const transformedExercises: DatabaseExercise[] = (data || []).map((ex: any) => ({
          id: ex.id,
          name: ex.name,
          target_muscle: ex.target_muscle,
          category: ex.category,
          type: 'strength' as const, // All gym exercises are strength
          icon: muscleToIcon[ex.target_muscle] || '💪',
        }));

        setExercises(transformedExercises);
      } catch (err) {
        console.error('Failed to fetch exercises:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchExercises();
  }, []);

  // Set initial tab based on current exercise
  useEffect(() => {
    if (currentExercise) {
      setSelectedTab(classifyExercise(currentExercise));
      
      // Highlight and scroll after a short delay
      setTimeout(() => {
        setHighlightedExercise(currentExercise.name);
        exerciseRefs.current[currentExercise.name]?.scrollIntoView({ 
          block: 'center', 
          behavior: 'smooth' 
        });
        
        setTimeout(() => setHighlightedExercise(null), 1000);
      }, 100);
    }
  }, [currentExercise]);

  const hasSearch = searchValue.trim().length > 0;
  
  // Filter exercises based on search and selected tab
  let filteredExercises = [...exercises];
  
  if (hasSearch) {
    // Normalize search for German characters
    const normalizedSearch = searchValue.toLowerCase();
    filteredExercises = filteredExercises.filter(ex => 
      ex.name.toLowerCase().includes(normalizedSearch)
    );
  } else {
    // Filter by selected category. Classification is total, so the two
    // categories together always cover the whole catalogue.
    filteredExercises = filteredExercises.filter(
      ex => classifyExercise(ex) === selectedTab
    );
  }
  
  // Group by target muscle
  const groupedExercises = filteredExercises.reduce((acc, ex) => {
    const muscle = ex.target_muscle;
    if (!acc[muscle]) acc[muscle] = [];
    acc[muscle].push(ex);
    return acc;
  }, {} as Record<string, DatabaseExercise[]>);

  // German translations for muscle groups
  const muscleTranslations: Record<string, string> = {
    'Chest': 'Brust',
    'Back': 'Rücken',
    'Legs': 'Beine',
    'Shoulders': 'Schultern',
    'Triceps': 'Trizeps',
    'Biceps': 'Bizeps',
    'Abs': 'Bauch',
  };

  return (
    <div className={cn("space-y-3", className)}>
      <Command className="rounded-lg border">
        <CommandInput 
          placeholder="Übung suchen..." 
          value={searchValue}
          onValueChange={setSearchValue}
          autoFocus={false}
          inputMode="search"
        />
      </Command>
      
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as ExerciseCategory)}>
        <TabsList className="grid w-full grid-cols-2">
          {EXERCISE_CATEGORIES.map((category) => (
            <TabsTrigger key={category.id} value={category.id}>
              {category.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      
      <Command className="rounded-lg border">
        <CommandList>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
              <span className="ml-2 text-sm text-muted-foreground">Übungen laden...</span>
            </div>
          ) : (
            <>
              <CommandEmpty>Keine Übung gefunden.</CommandEmpty>
              
              {Object.entries(groupedExercises).map(([muscle, muscleExercises]) => (
                <CommandGroup key={muscle} heading={muscleTranslations[muscle] || muscle}>
                  {muscleExercises.map((exercise) => (
                    <CommandItem
                      key={exercise.id}
                      value={exercise.name}
                      onSelect={() => onSelect(exercise)}
                      ref={(el) => { exerciseRefs.current[exercise.name] = el; }}
                      className={cn(
                        "cursor-pointer",
                        highlightedExercise === exercise.name && "animate-pulse bg-emerald-500/10"
                      )}
                    >
                      <span className="mr-2 text-lg">{exercise.icon}</span>
                      <div className="flex flex-col">
                        <span>{exercise.name}</span>
                        <span className="text-xs text-muted-foreground">{exercise.category}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </>
          )}
        </CommandList>
      </Command>
    </div>
  );
};

// Export for backwards compatibility - but now uses database
export const PREDEFINED_EXERCISES: DatabaseExercise[] = [];
