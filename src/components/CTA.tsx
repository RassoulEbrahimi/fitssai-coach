import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

interface CTAProps {
  onGetStarted: () => void;
}

const CTA = ({ onGetStarted }: CTAProps) => {
  return (
    <section className="py-24 bg-gradient-card">
      <div className="container mx-auto px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full mb-8 border border-primary/20">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">Ready to Transform?</span>
          </div>
          
          <h2 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            Start Your
            <span className="block gradient-primary bg-clip-text text-transparent">
              AI-Powered Journey
            </span>
          </h2>
          
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed">
            Join thousands of users who have already transformed their fitness with FitssAI. 
            Get your personalized plan in under 5 minutes.
          </p>
          
          <Button 
            size="lg" 
            variant="hero"
            onClick={onGetStarted}
            className="px-12 py-6 text-xl"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-6 w-6" />
          </Button>
          
          <p className="text-sm text-muted-foreground mt-4">
            No credit card required • 7-day free trial
          </p>
        </div>
      </div>
    </section>
  );
};

export default CTA;