import React, { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { RefreshCw, Sparkles, User, Ruler, Weight, Activity, Settings, Calendar, Crown, Pencil } from "lucide-react";
import { AIAnalyticsCard } from "@/components/AIAnalyticsCard";
import { LogoutButton } from "@/components/LogoutButton";
import { DeleteAccountButton } from "@/components/DeleteAccountButton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/contexts/PreferencesContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProfileViewProps {
  profile: any;
  onProfileUpdate: () => void;
  workoutProgress: { completed: number; total: number };
  generatingPlans?: boolean;
  workoutPlan?: any;
  nutritionPlan?: any;
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
const GlassCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md ${className}`}>
    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
    <div className="relative">{children}</div>
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
      <div className={`p-2 rounded-lg ${accent ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-muted-foreground"}`}>
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
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    full_name: "",
    weight: 0,
    height: 0,
    age: 0,
  });

  // Get values from profile or show placeholder
  const displayName = profile?.full_name || "--";
  const displayWeight = profile?.weight ?? "--";
  const displayHeight = profile?.height ?? "--";
  const displayAge = profile?.age ?? "--";
  const isPro = true; // Placeholder - will be connected to subscription later
  const memberSince = profile?.created_at ? new Date(profile.created_at).getFullYear() : "--";

  // Calculate BMI from real data
  const bmi = calculateBMI(profile?.weight, profile?.height);
  const bmiStatus = getBMIStatus(bmi);

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
    setIsEditOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.id) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: formData.full_name || null,
          weight: formData.weight || null,
          height: formData.height || null,
          age: formData.age || null,
        })
        .eq("id", profile.id);

      if (error) throw error;

      toast.success("Profil aktualisiert");
      setIsEditOpen(false);
      onProfileUpdate();
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-2xl mx-auto px-4 pb-32 space-y-6"
    >
      {/* Section 1: Profile Header */}
      <motion.section variants={itemVariants} className="pt-4">
        <GlassCard className="p-6">
          <div className="flex items-center gap-4">
            {/* Avatar with glow ring */}
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full blur-md opacity-60" />
              <Avatar className="relative h-20 w-20 border-2 border-emerald-400/50 shadow-lg shadow-emerald-500/30">
                <AvatarImage src={profile?.avatar_url} alt={displayName} />
                <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-xl font-bold">
                  {getInitials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
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

      {/* Section 3: Settings */}
      <motion.section variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Settings className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Einstellungen</h2>
        </div>
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
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
        <DialogContent className="bg-background/95 backdrop-blur-xl border-white/10">
          <DialogHeader>
            <DialogTitle>Profil bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
});

ProfileView.displayName = 'ProfileView';

export default ProfileView;
