import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type SmartFocusType = 'auto' | 'cardio' | 'kraft' | 'weniger' | 'mehr' | 'mobilitaet' | 'gelenk_knie' | 'gelenk_hand';

interface SmartFocusBarProps {
  value?: SmartFocusType;
  onChange: (value: SmartFocusType) => void;
  disabled?: boolean;
}

const focusDescriptions: Record<SmartFocusType, string> = {
  auto: "Automatische Anpassung auf Basis deiner Historie.",
  cardio: "Mehr Fokus auf Ausdauerübungen und Herz-Kreislauf.",
  kraft: "Stärkerer Kraft-Schwerpunkt mit progressiver Überlastung.",
  weniger: "Geringere Intensität, längere Pausen, leichtere Varianten.",
  mehr: "Höhere Intensität, kürzere Pausen, anspruchsvollere Varianten.",
  mobilitaet: "Mehr Beweglichkeit, Mobility- und Stretch-Elemente.",
  gelenk_knie: "Knie-schonend: Vermeidung tiefer Kniebelastungen, Alternativen.",
  gelenk_hand: "Handgelenk-schonend: Push-up-Alternativen/Griffe."
};

const focusLabels: Record<SmartFocusType, string> = {
  auto: "Auto",
  cardio: "Cardio",
  kraft: "Kraft",
  weniger: "Weniger",
  mehr: "Mehr",
  mobilitaet: "Mobilität",
  gelenk_knie: "Knie-schonend",
  gelenk_hand: "Hand-schonend"
};

const focusEmojis: Record<SmartFocusType, string> = {
  auto: "🤖",
  cardio: "❤️",
  kraft: "💪",
  weniger: "🌿",
  mehr: "🔥",
  mobilitaet: "🧘",
  gelenk_knie: "🦵",
  gelenk_hand: "✋"
};

export function SmartFocusBar({ value = 'auto', onChange, disabled = false }: SmartFocusBarProps) {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handleCycleCardioKraft = () => {
    if (value === 'cardio') onChange('kraft');
    else if (value === 'kraft') onChange('cardio');
    else onChange('cardio');
  };

  const handleCycleIntensity = () => {
    if (value === 'weniger') onChange('mehr');
    else if (value === 'mehr') onChange('weniger');
    else onChange('weniger');
  };

  const handleCycleGelenk = () => {
    if (value === 'gelenk_knie') onChange('gelenk_hand');
    else if (value === 'gelenk_hand') onChange('auto');
    else onChange('gelenk_knie');
  };

  const handleMobilitaet = () => {
    onChange(value === 'mobilitaet' ? 'auto' : 'mobilitaet');
  };

  const handleAuto = () => {
    onChange('auto');
  };

  const chipVariants = prefersReducedMotion ? {} : {
    tap: { scale: 0.95 },
    hover: { scale: 1.05 }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-center">
        {/* Auto Chip */}
        <motion.button
          onClick={handleAuto}
          disabled={disabled}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all",
            "border-2 flex items-center gap-2",
            value === 'auto'
              ? "bg-primary/20 border-primary text-primary shadow-glow"
              : "bg-background/50 border-border/50 text-muted-foreground hover:border-primary/50"
          )}
          variants={chipVariants}
          whileHover={!disabled ? "hover" : undefined}
          whileTap={!disabled ? "tap" : undefined}
        >
          {focusEmojis.auto} {focusLabels.auto}
          {value === 'auto' && <span className="text-xs">✓</span>}
        </motion.button>

        {/* Cardio/Kraft Toggle */}
        <motion.button
          onClick={handleCycleCardioKraft}
          disabled={disabled}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all",
            "border-2 flex items-center gap-2",
            (value === 'cardio' || value === 'kraft')
              ? "bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-glow"
              : "bg-background/50 border-border/50 text-muted-foreground hover:border-emerald-500/50"
          )}
          variants={chipVariants}
          whileHover={!disabled ? "hover" : undefined}
          whileTap={!disabled ? "tap" : undefined}
        >
          {value === 'cardio' ? (
            <>
              {focusEmojis.cardio} {focusLabels.cardio} <span className="text-xs">✓</span>
            </>
          ) : value === 'kraft' ? (
            <>
              {focusEmojis.kraft} {focusLabels.kraft} <span className="text-xs">✓</span>
            </>
          ) : (
            <>
              {focusEmojis.cardio}/{focusEmojis.kraft} Cardio/Kraft
            </>
          )}
        </motion.button>

        {/* Intensität Toggle */}
        <motion.button
          onClick={handleCycleIntensity}
          disabled={disabled}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all",
            "border-2 flex items-center gap-2",
            (value === 'weniger' || value === 'mehr')
              ? "bg-orange-500/20 border-orange-500 text-orange-500 shadow-glow"
              : "bg-background/50 border-border/50 text-muted-foreground hover:border-orange-500/50"
          )}
          variants={chipVariants}
          whileHover={!disabled ? "hover" : undefined}
          whileTap={!disabled ? "tap" : undefined}
        >
          {value === 'weniger' ? (
            <>
              {focusEmojis.weniger} {focusLabels.weniger} <span className="text-xs">✓</span>
            </>
          ) : value === 'mehr' ? (
            <>
              {focusEmojis.mehr} {focusLabels.mehr} <span className="text-xs">✓</span>
            </>
          ) : (
            <>
              {focusEmojis.weniger}/{focusEmojis.mehr} Intensität
            </>
          )}
        </motion.button>

        {/* Mobilität */}
        <motion.button
          onClick={handleMobilitaet}
          disabled={disabled}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all",
            "border-2 flex items-center gap-2",
            value === 'mobilitaet'
              ? "bg-violet-500/20 border-violet-500 text-violet-500 shadow-glow"
              : "bg-background/50 border-border/50 text-muted-foreground hover:border-violet-500/50"
          )}
          variants={chipVariants}
          whileHover={!disabled ? "hover" : undefined}
          whileTap={!disabled ? "tap" : undefined}
        >
          {focusEmojis.mobilitaet} {focusLabels.mobilitaet}
          {value === 'mobilitaet' && <span className="text-xs">✓</span>}
        </motion.button>

        {/* Gelenk-schonend Cycle */}
        <motion.button
          onClick={handleCycleGelenk}
          disabled={disabled}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-all",
            "border-2 flex items-center gap-2",
            (value === 'gelenk_knie' || value === 'gelenk_hand')
              ? "bg-blue-500/20 border-blue-500 text-blue-500 shadow-glow"
              : "bg-background/50 border-border/50 text-muted-foreground hover:border-blue-500/50"
          )}
          variants={chipVariants}
          whileHover={!disabled ? "hover" : undefined}
          whileTap={!disabled ? "tap" : undefined}
        >
          {value === 'gelenk_knie' ? (
            <>
              {focusEmojis.gelenk_knie} {focusLabels.gelenk_knie} <span className="text-xs">✓</span>
            </>
          ) : value === 'gelenk_hand' ? (
            <>
              {focusEmojis.gelenk_hand} {focusLabels.gelenk_hand} <span className="text-xs">✓</span>
            </>
          ) : (
            <>
              {focusEmojis.gelenk_knie}/{focusEmojis.gelenk_hand} Gelenk-schonend
            </>
          )}
        </motion.button>
      </div>

      {/* Description */}
      <motion.p
        key={value}
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="text-sm text-center text-muted-foreground px-4"
      >
        {focusDescriptions[value]}
      </motion.p>
    </div>
  );
}
