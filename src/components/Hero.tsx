import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

interface HeroProps {
  onGetStarted: () => void;
}

const Hero = ({ onGetStarted }: HeroProps) => {
  const { t } = useTranslation();

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-zinc-950 text-white selection:bg-primary/30">
      {/* Background Elements */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-500/5 rounded-full blur-[120px]" />

        {/* Subtle Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />
      </div>

      <div className="container relative z-10 px-6 mx-auto">
        <div className="max-w-4xl mx-auto text-center">

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex justify-center mb-8"
          >
            <span className="inline-flex items-center px-3 py-1 text-sm font-medium border rounded-full border-white/10 bg-white/5 text-primary-glow backdrop-blur-sm">
              {t('hero.badge')}
            </span>
          </motion.div>

          {/* Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
            className="mb-8 text-5xl font-bold tracking-tight md:text-7xl lg:text-8xl"
          >
            <span className="block text-white drop-shadow-sm">
              {t('hero.title')}
            </span>
            <span className="block mt-2 bg-gradient-to-r from-primary via-emerald-400 to-teal-400 bg-clip-text text-transparent pb-4">
              {t('hero.titleHighlight')}
            </span>
          </motion.h1>

          {/* Subline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="max-w-2xl mx-auto mb-12 text-lg text-zinc-400 md:text-xl leading-relaxed"
          >
            {t('hero.subline')}
          </motion.p>

          {/* Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
            className="flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <Button
              size="lg"
              onClick={onGetStarted}
              className="w-full sm:w-auto px-8 h-12 text-base font-semibold bg-white text-black hover:bg-zinc-200 hover:scale-105 transition-all duration-300 rounded-full"
            >
              {t('hero.startJourney')}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto px-8 h-12 text-base border-zinc-800 text-zinc-400 hover:text-white hover:bg-white/5 hover:border-zinc-700 rounded-full bg-transparent backdrop-blur-sm"
            >
              <Play className="w-3.5 h-3.5 mr-2 fill-current" />
              {t('hero.watchDemo')}
            </Button>
          </motion.div>

          {/* Optional Stats Stripe (Simplified) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
            className="mt-20 pt-10 border-t border-white/5 grid grid-cols-2 md:grid-cols-3 gap-8 text-center max-w-3xl mx-auto"
          >
            <div>
              <div className="text-2xl font-bold text-white mb-1">20k+</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">{t('hero.stats.activeUsers')}</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white mb-1">98%</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">{t('hero.stats.successRate')}</div>
            </div>
            <div className="col-span-2 md:col-span-1">
              <div className="text-2xl font-bold text-white mb-1">24/7</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">{t('hero.stats.support')}</div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
};

export default Hero;