import { Home, Dumbbell, Utensils, User2 } from 'lucide-react';
import { useState, useCallback, forwardRef } from 'react';

type Tab = 'workout' | 'nutrition' | 'profile' | 'dashboard';

interface BottomNavProps {
  activeTab: 'workout' | 'nutrition' | 'profile';
  onChange: (tab: Tab) => void;
}

/**
 * Prefetches view components on user intent (hover/touch) to make tab switching feel instant
 */
const usePrefetchViews = () => {
  const [prefetchedTabs, setPrefetchedTabs] = useState<Set<Tab>>(new Set());
  
  const prefetchView = useCallback(async (tab: Tab) => {
    if (prefetchedTabs.has(tab)) return;
    
    try {
      setPrefetchedTabs(prev => new Set(prev).add(tab));
      
      switch (tab) {
        case 'workout':
          await import('@/views/WorkoutView');
          break;
        case 'nutrition':
          await import('@/views/NutritionView');
          break;
        case 'profile':
          await import('@/views/ProfileView');
          break;
      }
    } catch (error) {
      console.warn(`Failed to prefetch ${tab} view:`, error);
    }
  }, [prefetchedTabs]);
  
  return { prefetchView, prefetchedTabs };
};

export default forwardRef<HTMLElement, BottomNavProps>(function BottomNav({ activeTab, onChange }, ref) {
  const { prefetchView } = usePrefetchViews();
  const [touchStarted, setTouchStarted] = useState<Set<Tab>>(new Set());

  /**
   * Handles prefetching on mouse enter (desktop) and first touch (mobile)
   */
  const handlePrefetchIntent = useCallback((tab: Tab, eventType: 'mouse' | 'touch') => {
    if (tab === 'dashboard') return;
    
    if (eventType === 'touch') {
      // Only prefetch on first touch to avoid excessive prefetching on mobile
      if (touchStarted.has(tab)) return;
      setTouchStarted(prev => new Set(prev).add(tab));
    }
    
    prefetchView(tab);
  }, [prefetchView, touchStarted]);

  const Item = ({ id, label, Icon }: { id: Tab; label: string; Icon: any }) => {
    const isActive = (id !== 'dashboard' ? activeTab === id : false);
    
    return (
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-current={isActive ? 'page' : undefined}
        aria-label={label}
        onClick={() => onChange(id)}
        onMouseEnter={() => handlePrefetchIntent(id, 'mouse')}
        onTouchStart={() => handlePrefetchIntent(id, 'touch')}
        className={`flex-1 py-2.5 text-xs flex flex-col items-center gap-1 min-h-[44px] transition-colors ${
          isActive ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <Icon aria-hidden="true" className="h-5 w-5" />
        <span className="font-medium">{label}</span>
        <span className={`h-0.5 w-8 rounded-full transition-colors ${
          isActive ? 'bg-primary' : 'bg-transparent'
        }`} />
      </button>
    );
  };

  return (
    <nav 
      ref={ref}
      role="tablist" 
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-background/80 backdrop-blur border-t"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto max-w-screen-sm flex">
        <Item id="dashboard" label="Dashboard" Icon={Home} />
        <Item id="workout" label="Trainingsplan" Icon={Dumbbell} />
        <Item id="nutrition" label="Ernährungsplan" Icon={Utensils} />
        <Item id="profile" label="Profil" Icon={User2} />
      </div>
    </nav>
  );
});