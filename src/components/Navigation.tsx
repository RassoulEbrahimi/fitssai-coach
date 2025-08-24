import { Button } from "@/components/ui/button";
import { Dumbbell } from "lucide-react";

interface NavigationProps {
  onGetStarted: () => void;
}

const Navigation = ({ onGetStarted }: NavigationProps) => {
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
            Features
          </a>
          <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-smooth">
            Pricing
          </a>
          <a href="#about" className="text-muted-foreground hover:text-foreground transition-smooth">
            About
          </a>
        </div>
        
        <div className="flex items-center gap-4">
          <Button variant="ghost">Sign In</Button>
          <Button 
            variant="hero"
            onClick={onGetStarted}
          >
            Get Started
          </Button>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;