import { Button } from "@/components/ui/button";
import { Dumbbell } from "lucide-react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./LanguageSwitcher";

interface NavigationProps {
  onGetStarted: () => void;
}

const Navigation = ({ onGetStarted }: NavigationProps) => {
  const { t } = useTranslation();
  
  return (
    <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="gradient-primary p-2 rounded-lg">
            <Dumbbell className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">FitssAI</span>
        </div>
        
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-muted-foreground hover:text-foreground transition-smooth">
            {t('navigation.features')}
          </a>
          <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-smooth">
            {t('navigation.pricing')}
          </a>
          <a href="#about" className="text-muted-foreground hover:text-foreground transition-smooth">
            {t('navigation.about')}
          </a>
        </div>
        
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Button variant="ghost">{t('navigation.signIn')}</Button>
          <Button 
            variant="hero"
            onClick={onGetStarted}
          >
            {t('navigation.getStarted')}
          </Button>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;