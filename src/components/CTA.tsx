import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CTAProps {
  onGetStarted: () => void;
}

const CTA = ({ onGetStarted }: CTAProps) => {
  const { t } = useTranslation();
  
  return (
    <section className="py-24 bg-gradient-card">
      <div className="container mx-auto px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full mb-8 border border-primary/20">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">{t('cta.badge')}</span>
          </div>
          
          <h2 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            {t('cta.title')}
            <span className="block text-primary font-bold">
              {t('cta.titleHighlight')}
            </span>
          </h2>
          
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed">
            {t('cta.description')}
          </p>
          
          <Button 
            size="lg" 
            variant="hero"
            onClick={onGetStarted}
            className="px-12 py-6 text-xl"
          >
            {t('cta.getStartedFree')}
            <ArrowRight className="ml-2 h-6 w-6" />
          </Button>
          
          <p className="text-sm text-muted-foreground mt-4">
            {t('cta.disclaimer')}
          </p>
        </div>
      </div>
    </section>
  );
};

export default CTA;