import { Home, Dumbbell, Utensils, User2 } from 'lucide-react';

type Tab = 'workout' | 'nutrition' | 'profile' | 'dashboard';

interface BottomNavProps {
  activeTab: 'workout' | 'nutrition' | 'profile';
  onChange: (tab: Tab) => void;
}

export default function BottomNav({ activeTab, onChange }: BottomNavProps) {
  const Item = ({ id, label, Icon }: { id: Tab; label: string; Icon: any }) => {
    const isActive = (id !== 'dashboard' ? activeTab === id : false);
    return (
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={label}
        onClick={() => onChange(id)}
        className={`flex-1 py-2.5 text-xs flex flex-col items-center gap-1 min-h-[44px] transition-colors ${
          isActive ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <Icon className="h-5 w-5" />
        <span className="font-medium">{label}</span>
        <span className={`h-0.5 w-8 rounded-full transition-colors ${
          isActive ? 'bg-primary' : 'bg-transparent'
        }`} />
      </button>
    );
  };

  return (
    <nav 
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
}