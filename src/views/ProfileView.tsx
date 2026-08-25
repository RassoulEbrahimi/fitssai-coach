import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { RefreshCw, Sparkles, User, Ruler, Weight, Activity, Settings, Calendar, Crown, Pencil, Target, Utensils, Camera, Loader2, Flame, Clock, Zap, Sun, Moon, Monitor } from "lucide-react";
import { AIAnalyticsCard } from "@/components/AIAnalyticsCard";
import { LogoutButton } from "@/components/LogoutButton";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePreferences } from "@/contexts/PreferencesContext";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth as _useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "sonner";
import { uploadAvatar, updateProfileAvatar, getAvatarUrl } from "@/lib/avatarUtils";
import { WorkoutPlan, NutritionPlan } from "@/lib/types";

import { Profile } from "@/hooks/queries/useProfile";

interface ProfileViewProps {
  profile: Profile | null;
  onProfileUpdate: () => void;
  workoutProgress: { completed: number; total: number };
  generatingPlans?: boolean;
  workoutPlan?: WorkoutPlan;
  nutritionPlan?: NutritionPlan;
  onGeneratePlans?: () => void;
}

// BMI calculation and status
const calculateBMI = (weight: number, height: number): number | null => {
  if (!weight || !height || weight <= 0 || height <= 0) return null;
  const heightInMeters = height / 100;
  return weight / (heightInMeters * heightInMeters);
};

const getBMIStatus = (bmi: number | null): { label: string; color: string } => {
  if (bmi === null) return { label: "--", color: "text-muted-foreground" };
  if (bmi < 18.5) return { label: "Untergewicht", color: "text-blue-400" };
  if (bmi < 25) return { label: "Normal", color: "text-emerald-400" };
  if (bmi < 30) return { label: "Übergewicht", color: "text-amber-400" };
  return { label: "Adipositas", color: "text-red-400" };
};

// Goal and diet mappings
const fitnessGoalLabels: Record<string, string> = {
  muscle_gain: "Muskelaufbau",
  weight_loss: "Gewichtsverlust",
  maintenance: "Erhaltung",
  endurance: "Ausdauer",
};

const dietaryLabels: Record<string, string> = {
  standard: "Standard",
  vegan: "Vegan",
  vegetarian: "Vegetarisch",
  keto: "Keto",
  pescetarian: "Pescetarisch",
};

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15,
    },
  },
};

// Glass card component
const GlassCard: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({ children, className = "", onClick }) => (
  <div
    className={`relative overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-md ${onClick ? "cursor-pointer hover:bg-accent transition-colors" : ""} ${className}`}
    onClick={onClick}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-foreground/5 to-transparent pointer-events-none" />
    <div className="relative">{children}</div>
  </div>
);

// Circular Progress Component
interface CircularProgressProps {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}

const CircularProgress: React.FC<CircularProgressProps> = ({
  value,
  max,
  size = 100,
  strokeWidth = 8,
  className = "",
  children,
}) => {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="block"
        style={{ transform: 'rotate(-90deg)' }}
        role="img"
        aria-label={`Progress ${Math.round(percentage)}%`}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="text-muted-foreground/20"
          stroke="currentColor"
        />
        {/* Progress with gradient effect */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="text-emerald-400"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            filter: 'drop-shadow(0 0 6px hsl(var(--emerald-glow, 160 84% 50%) / 0.5))'
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
};

// Mini stat item for progress section
const MiniStat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="flex items-center gap-2">
    <div className="p-1.5 rounded-lg bg-muted text-muted-foreground">
      {icon}
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  </div>
);

// Stat card component
const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  children?: React.ReactNode;
}> = ({ icon, label, value, unit, accent, children }) => (
  <GlassCard className="p-4">
    <div className="flex items-center gap-2 mb-2">
      <div className={`p-2 rounded-lg ${accent ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
        {icon}
      </div>
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
    <div className="flex items-baseline gap-1">
      <span className={`text-2xl font-bold ${accent ? "text-emerald-400" : "text-foreground"}`}>{value}</span>
      {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
    </div>
    {children}
  </GlassCard>
);

const ProfileView: React.FC<ProfileViewProps> = React.memo(({
  profile,
  onProfileUpdate,
  workoutProgress,
  generatingPlans = false,
  workoutPlan,
  nutritionPlan,
  onGeneratePlans
}) => {
  const { enableAdvancedGlass, setEnableAdvancedGlass } = usePreferences();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isGoalsOpen, setIsGoalsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    full_name: "",
    weight: 0,
    height: 0,
    age: 0,
  });

  const [goalsData, setGoalsData] = useState({
    fitness_goal: "",
    dietary_preference: "",
  });

  // User stats from database
  const [userStats, setUserStats] = useState({
    streak: 0,
    minutes: 0,
    calories: 0,
  });

  // Theme is owned by ThemeProvider (useTheme) — this screen only renders the control.
  const { theme: themeMode, setTheme: setThemeMode } = useTheme();

  // Fetch user stats on mount
  useEffect(() => {
    const fetchUserStats = async () => {
      try {
        const data = null; // get_user_stats RPC removed — stats disabled during migration
        const error = null;
        if (error) {
          console.error('Error fetching user stats:', error);
          return;
        }
        if (data && typeof data === 'object') {
          const stats = data as { streak?: number; minutes?: number; calories?: number };
          setUserStats({
            streak: stats.streak ?? 0,
            minutes: stats.minutes ?? 0,
            calories: stats.calories ?? 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch user stats:', err);
      }
    };

    fetchUserStats();
  }, [profile?.id]);

  // Get values from profile or show placeholder
  const displayName = profile?.full_name || "--";
  const displayWeight = profile?.weight ?? "--";
  const displayHeight = profile?.height ?? "--";
  const displayAge = profile?.age ?? "--";
  const isPro = true; // Placeholder - will be connected to subscription later
  const memberSince = profile?.created_at ? new Date(profile.created_at).getFullYear() : "--";

  // Get avatar URL
  const avatarUrl = getAvatarUrl(profile?.avatar_path);

  // Calculate BMI from real data
  const bmi = calculateBMI(profile?.weight, profile?.height);
  const bmiStatus = getBMIStatus(bmi);

  // Get display values for goals
  const displayGoal = fitnessGoalLabels[profile?.fitness_goal] || profile?.fitness_goal || "--";
  const displayDiet = dietaryLabels[profile?.dietary_preference] || profile?.dietary_preference || "--";

  // Get initials for avatar
  const getInitials = (name: string | null | undefined) => {
    if (!name || name === "--") return "??";
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleOpenEdit = () => {
    setFormData({
      full_name: profile?.full_name || "",
      weight: profile?.weight || 0,
      height: profile?.height || 0,
      age: profile?.age || 0,
    });
    setAvatarPreview(null);
    setSelectedFile(null);
    setIsEditOpen(true);
  };

  const handleOpenGoals = () => {
    setGoalsData({
      fitness_goal: profile?.fitness_goal || "",
      dietary_preference: profile?.dietary_preference || "",
    });
    setIsGoalsOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error("Bitte wähle ein Bild aus");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Bild darf maximal 5MB groß sein");
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!profile?.id) return;

    // Client-side validation for data integrity
    const { weight, height, age } = formData;

    if (weight !== 0 && (weight < 20 || weight > 500)) {
      toast.error("Gewicht muss zwischen 20 und 500 kg liegen");
      return;
    }
    if (height !== 0 && (height < 50 || height > 300)) {
      toast.error("Größe muss zwischen 50 und 300 cm liegen");
      return;
    }
    if (age !== 0 && (age < 1 || age > 150)) {
      toast.error("Alter muss zwischen 1 und 150 Jahren liegen");
      return;
    }

    setIsSaving(true);
    try {
      // Upload avatar if selected
      let avatarPath = profile?.avatar_path;
      if (selectedFile) {
        setIsUploading(true);
        avatarPath = await uploadAvatar(profile.id, selectedFile);
        await updateProfileAvatar(profile.id, avatarPath);
        setIsUploading(false);
      }

      await setDoc(doc(db, 'users', profile.id), {
        fullName:  formData.full_name?.trim() || null,
        weight:    weight || null,
        height:    height || null,
        age:       age    || null,
        updatedAt: Timestamp.now(),
      }, { merge: true });

      toast.success("Profil aktualisiert");
      setIsEditOpen(false);
      setSelectedFile(null);
      setAvatarPreview(null);
      onProfileUpdate();
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
      setIsUploading(false);
    }
  };

  const handleSaveGoals = async () => {
    if (!profile?.id) return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'users', profile.id), {
        fitnessGoal:       goalsData.fitness_goal || null,
        dietaryPreference: goalsData.dietary_preference || null,
        updatedAt:         Timestamp.now(),
      }, { merge: true });

      toast.success("Ziele aktualisiert");
      setIsGoalsOpen(false);
      onProfileUpdate();
    } catch (error) {
      console.error("Error updating goals:", error);
      toast.error("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-24">
      {/* Section 1: Profile Header */}
      <motion.section variants={itemVariants} className="pt-4">
        <GlassCard className="p-6">
          <div className="flex items-center gap-4">
            {/* Avatar with glow ring - clickable */}
            <div className="relative cursor-pointer group" onClick={handleOpenEdit}>
              <div className="absolute -inset-1 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full blur-md opacity-60 group-hover:opacity-80 transition-opacity" />
              <Avatar className="relative h-20 w-20 border-2 border-emerald-400/50 shadow-lg shadow-emerald-500/30 group-hover:border-emerald-400 transition-colors">
                <AvatarImage src={avatarUrl || undefined} alt={displayName} />
                <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-xl font-bold">
                  {getInitials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-5 h-5 text-white" />
              </div>
            </div>

            {/* User info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground truncate">
                  {displayName}
                </h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={handleOpenEdit}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Badge
                  variant="outline"
                  className={`shrink-0 ${isPro
                    ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-400"
                    : "border-muted-foreground/30 bg-muted/10 text-muted-foreground"}`}
                >
                  <Crown className="w-3 h-3 mr-1" />
                  {isPro ? "Pro Mitglied" : "Free Plan"}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                <span>Mitglied seit {memberSince}</span>
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.section>

      {/* Section 2: Body Stats */}
      <motion.section variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Körperdaten</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<Weight className="w-4 h-4" />}
            label="Gewicht"
            value={displayWeight}
            unit={displayWeight !== "--" ? "kg" : undefined}
          />
          <StatCard
            icon={<Ruler className="w-4 h-4" />}
            label="Größe"
            value={displayHeight}
            unit={displayHeight !== "--" ? "cm" : undefined}
          />
          <StatCard
            icon={<User className="w-4 h-4" />}
            label="Alter"
            value={displayAge}
            unit={displayAge !== "--" ? "Jahre" : undefined}
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label="BMI"
            value={bmi !== null ? bmi.toFixed(1) : "--"}
            accent={bmi !== null}
          >
            <div className="mt-1">
              <span className={`text-xs font-medium ${bmiStatus.color}`}>
                {bmiStatus.label}
              </span>
            </div>
          </StatCard>
        </div>
      </motion.section>

      {/* Section 2.5: Training & Progress */}
      <motion.section variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Training & Fortschritt</h2>
        </div>
        <GlassCard className="p-5">
          <div className="flex items-center gap-6">
            {/* Left: Circular Progress */}
            <div className="flex flex-col items-center gap-2">
              <CircularProgress
                value={workoutProgress.completed}
                max={workoutProgress.total || 7}
                size={90}
                strokeWidth={8}
              >
                <span className="text-lg font-bold text-foreground">
                  {workoutProgress.total > 0
                    ? `${workoutProgress.completed}/${workoutProgress.total}`
                    : "0/7"}
                </span>
              </CircularProgress>
              <span className="text-xs text-muted-foreground font-medium">Wochenziel</span>
            </div>

            {/* Right: Stats Grid */}
            <div className="flex-1 grid grid-cols-1 gap-3">
              <MiniStat
                icon={<Flame className="w-3.5 h-3.5 text-orange-400" />}
                label="Streak"
                value={`${userStats.streak} ${userStats.streak === 1 ? 'Tag' : 'Tage'}`}
              />
              <MiniStat
                icon={<Clock className="w-3.5 h-3.5 text-blue-400" />}
                label="Gesamtzeit"
                value={`${userStats.minutes} Min`}
              />
              <MiniStat
                icon={<Zap className="w-3.5 h-3.5 text-amber-400" />}
                label="Kcal"
                value={userStats.calories.toLocaleString('de-DE')}
              />
            </div>
          </div>
        </GlassCard>
      </motion.section>

      {/* Section 3: Goals & Diet */}
      <motion.section variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Target className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Ernährung & Ziele</h2>
        </div>
        <GlassCard className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Target className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Ziel</span>
                  <p className="text-sm font-medium text-foreground">{displayGoal}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
                  <Utensils className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Diät</span>
                  <p className="text-sm font-medium text-foreground">{displayDiet}</p>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleOpenGoals}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        </GlassCard>
      </motion.section>

      {/* Section 4: Settings */}
      <motion.section variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Settings className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Einstellungen</h2>
        </div>
        <GlassCard className="p-4 space-y-5">
          {/* Appearance / Theme Toggle */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                {themeMode === 'dark' ? <Moon className="w-4 h-4" /> : themeMode === 'light' ? <Sun className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </div>
              <div>
                <span className="text-sm font-medium text-foreground">Erscheinungsbild</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Farbschema für die App
                </p>
              </div>
            </div>
            {/* Segmented Control */}
            <div className="flex rounded-xl bg-muted/50 p-1 gap-1">
              {[
                { value: 'system' as const, icon: Monitor, label: 'System' },
                { value: 'light' as const, icon: Sun, label: 'Hell' },
                { value: 'dark' as const, icon: Moon, label: 'Dunkel' },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setThemeMode(value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${themeMode === value
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shadow-sm'
                    : 'text-muted-foreground hover:bg-accent'
                    }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Premium Glass Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <Label htmlFor="advanced-glass-toggle" className="text-sm font-medium cursor-pointer">
                  Premium Liquid Glass
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Erweiterte Shimmer-Effekte aktivieren
                </p>
              </div>
            </div>
            <Switch
              id="advanced-glass-toggle"
              checked={enableAdvancedGlass}
              onCheckedChange={setEnableAdvancedGlass}
            />
          </div>
        </GlassCard>
      </motion.section>

      {/* AI Analytics Section */}
      <motion.section variants={itemVariants}>
        <AIAnalyticsCard />
      </motion.section>

      {/* Generate Plans Button */}
      {onGeneratePlans && (
        <motion.section variants={itemVariants}>
          <Button
            className="w-full py-6 text-lg rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all flex items-center justify-center gap-2"
            onClick={onGeneratePlans}
            disabled={generatingPlans}
          >
            <RefreshCw className={`w-5 h-5 ${generatingPlans ? 'animate-spin' : ''}`} />
            {generatingPlans ? "Pläne werden erstellt..." : (workoutPlan || nutritionPlan ? "Pläne neu generieren" : "Neue Pläne erstellen")}
          </Button>
        </motion.section>
      )}

      {/* Logout & Delete Account */}
      <motion.section variants={itemVariants} className="space-y-3">
        <LogoutButton />
        <DeleteAccountButton />
      </motion.section>

      {/* Edit Profile Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="bg-background/95 backdrop-blur-xl border-border">
          <DialogHeader>
            <DialogTitle>Profil bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Avatar Upload Area */}
            <div className="flex flex-col items-center gap-3">
              <div
                className="relative cursor-pointer group"
                onClick={() => !isUploading && fileInputRef.current?.click()}
              >
                <div className="absolute -inset-1 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full blur-md opacity-40 group-hover:opacity-60 transition-opacity" />
                <Avatar className="relative h-24 w-24 border-2 border-emerald-400/50 overflow-hidden">
                  <AvatarImage
                    src={avatarPreview || avatarUrl || undefined}
                    alt={displayName}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-2xl font-bold">
                    {getInitials(formData.full_name || profile?.full_name)}
                  </AvatarFallback>
                </Avatar>

                {/* Upload Progress Overlay */}
                {isUploading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full">
                    <div className="relative">
                      <svg className="w-12 h-12 animate-spin" viewBox="0 0 50 50">
                        <circle
                          cx="25"
                          cy="25"
                          r="20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          className="text-emerald-400/30"
                        />
                        <circle
                          cx="25"
                          cy="25"
                          r="20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeDasharray="80"
                          strokeDashoffset="60"
                          strokeLinecap="round"
                          className="text-emerald-400"
                        />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <p className="text-xs text-muted-foreground">
                {isUploading ? "Wird hochgeladen..." : "Klicke zum Ändern"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formData.full_name}
                onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                placeholder="Dein Name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-weight">Gewicht (kg)</Label>
                <Input
                  id="edit-weight"
                  type="number"
                  value={formData.weight || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, weight: Number(e.target.value) }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-height">Größe (cm)</Label>
                <Input
                  id="edit-height"
                  type="number"
                  value={formData.height || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, height: Number(e.target.value) }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-age">Alter</Label>
              <Input
                id="edit-age"
                type="number"
                value={formData.age || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, age: Number(e.target.value) }))}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isUploading}>
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Hochladen...
                </>
              ) : isSaving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Goals Dialog */}
      <Dialog open={isGoalsOpen} onOpenChange={setIsGoalsOpen}>
        <DialogContent className="bg-background/95 backdrop-blur-xl border-border">
          <DialogHeader>
            <DialogTitle>Ziele bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-goal">Fitness-Ziel</Label>
              <Select
                value={goalsData.fitness_goal}
                onValueChange={(value) => setGoalsData(prev => ({ ...prev, fitness_goal: value }))}
              >
                <SelectTrigger id="edit-goal">
                  <SelectValue placeholder="Wähle dein Ziel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="muscle_gain">Muskelaufbau</SelectItem>
                  <SelectItem value="weight_loss">Gewichtsverlust</SelectItem>
                  <SelectItem value="maintenance">Erhaltung</SelectItem>
                  <SelectItem value="endurance">Ausdauer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-diet">Ernährungsweise</Label>
              <Select
                value={goalsData.dietary_preference}
                onValueChange={(value) => setGoalsData(prev => ({ ...prev, dietary_preference: value }))}
              >
                <SelectTrigger id="edit-diet">
                  <SelectValue placeholder="Wähle deine Ernährungsweise" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="vegan">Vegan</SelectItem>
                  <SelectItem value="vegetarian">Vegetarisch</SelectItem>
                  <SelectItem value="keto">Keto</SelectItem>
                  <SelectItem value="pescetarian">Pescetarisch</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGoalsOpen(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveGoals} disabled={isSaving}>
              {isSaving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

ProfileView.displayName = 'ProfileView';

export default ProfileView;
