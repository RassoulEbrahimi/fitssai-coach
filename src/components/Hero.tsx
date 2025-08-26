import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import heroImage from "@/assets/hero-fitness.jpg";

interface HeroProps {
  onGetStarted: () => void;
}

const Hero = ({ onGetStarted }: HeroProps) => {
  const { t } = useTranslation();
  
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src={heroImage} 
          alt="AI-powered fitness training"
          className="object-cover w-full h-full opacity-30"
        />
        <div className="absolute inset-0 gradient-hero opacity-60"></div>
        <div className="absolute inset-0 bg-black/20"></div>
      </div>
      
      {/* Content */}
      <div className="relative z-10 container mx-auto px-6 text-center">
        <div className="max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-primary/20 text-primary px-4 py-2 rounded-full mb-8 border border-primary/40 backdrop-blur-sm">
              <Sparkles className="h-4 w-4" />
              <span className="text-sm font-medium" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>{t('hero.badge')}</span>
            </div>
          
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight text-white" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.7)' }}>
            {t('hero.title')}
            <span className="block text-primary-glow font-bold" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.7)' }}>
              {t('hero.titleHighlight')}
            </span>
          </h1>
          
          <p className="text-xl md:text-2xl text-gray-100 mb-12 max-w-3xl mx-auto leading-relaxed" style={{ textShadow: '1px 1px 3px rgba(0,0,0,0.6)' }}>
            {t('hero.description')}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              variant="hero"
              onClick={onGetStarted}
              className="px-8 py-4 text-lg"
            >
              {t('hero.startJourney')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="px-8 py-4 text-lg border-primary/30 hover:bg-primary/10"
            >
              {t('hero.watchDemo')}
            </Button>
          </div>
          
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center bg-black/20 backdrop-blur-sm rounded-lg p-6 border border-white/10">
              <div className="text-3xl font-bold text-primary mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>10K+</div>
              <div className="text-gray-200" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>{t('hero.stats.activeUsers')}</div>
            </div>
            <div className="text-center bg-black/20 backdrop-blur-sm rounded-lg p-6 border border-white/10">
              <div className="text-3xl font-bold text-primary mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>95%</div>
              <div className="text-gray-200" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>{t('hero.stats.successRate')}</div>
            </div>
            <div className="text-center bg-black/20 backdrop-blur-sm rounded-lg p-6 border border-white/10">
              <div className="text-3xl font-bold text-primary mb-2" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}>24/7</div>
              <div className="text-gray-200" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>{t('hero.stats.support')}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;