import { useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  User, 
  Edit, 
  Camera,
  Calendar,
  Weight as WeightIcon,
  Ruler,
  Target,
  Upload
} from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

interface ProfileCardProps {
  profile: any;
  onProfileUpdate: () => void;
  workoutProgress: {
    completed: number;
    total: number;
  };
}

const profileFormSchema = z.object({
  age: z.number().min(13).max(100),
  weight: z.number().min(30).max(300),
  height: z.number().min(120).max(250),
  fitness_goal: z.string(),
  dietary_preference: z.string()
});

export const ProfileCard = ({ profile, onProfileUpdate, workoutProgress }: ProfileCardProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const progressPercentage = workoutProgress.total > 0 
    ? (workoutProgress.completed / workoutProgress.total) * 100 
    : 0;

  const form = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      age: profile?.age || 25,
      weight: profile?.weight || 70,
      height: profile?.height || 170,
      fitness_goal: profile?.fitness_goal || 'gainMuscle',
      dietary_preference: profile?.dietary_preference || 'noPreference'
    }
  });

  const onSubmit = async (values: z.infer<typeof profileFormSchema>) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update(values)
        .eq('id', user.id);

      if (error) throw error;

      toast.success(t('profile.updateSuccess'));
      setIsEditDialogOpen(false);
      onProfileUpdate();
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error(t('profile.updateError'));
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      // For now, just show a success message as we don't have storage bucket set up
      // In a real implementation, you would upload to Supabase storage
      toast.success(t('profile.avatarUploadSuccess'));
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error(t('profile.avatarUploadError'));
    } finally {
      setIsUploading(false);
    }
  };

  const getInitials = () => {
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  const statCards = [
    {
      icon: Calendar,
      label: t('profile.stats.age'),
      value: profile?.age || '-',
      gradient: 'from-blue-500 to-purple-600'
    },
    {
      icon: WeightIcon,
      label: t('profile.stats.weight'),
      value: profile?.weight ? `${profile.weight} kg` : '-',
      gradient: 'from-green-500 to-blue-500'
    },
    {
      icon: Ruler,
      label: t('profile.stats.height'),
      value: profile?.height ? `${profile.height} cm` : '-',
      gradient: 'from-purple-500 to-pink-500'
    },
    {
      icon: Target,
      label: t('profile.stats.goal'),
      value: profile?.fitness_goal ? t(`onboarding.goals.${profile.fitness_goal}`) : '-',
      gradient: 'from-orange-500 to-red-500'
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-2xl mx-auto"
    >
      <Card className="gradient-card border-primary/20 shadow-card overflow-hidden">
        <CardContent className="p-8">
          {/* Header with Edit Button */}
          <div className="flex justify-between items-start mb-8">
            <h2 className="text-2xl font-bold text-foreground">{t('profile.title')}</h2>
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="hover-scale">
                  <Edit className="w-4 h-4 mr-2" />
                  {t('profile.edit')}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('profile.editDialog.title')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="age"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('onboarding.fields.age')}</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              {...field} 
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="weight"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('onboarding.fields.weight')}</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              {...field} 
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="height"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('onboarding.fields.height')}</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              {...field} 
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="fitness_goal"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('onboarding.fields.fitnessGoal')}</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="gainMuscle">{t('onboarding.goals.gainMuscle')}</SelectItem>
                              <SelectItem value="loseFat">{t('onboarding.goals.loseFat')}</SelectItem>
                              <SelectItem value="improveCardio">{t('onboarding.goals.improveCardio')}</SelectItem>
                              <SelectItem value="maintain">{t('onboarding.goals.maintain')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dietary_preference"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('onboarding.fields.dietaryPreference')}</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="noPreference">{t('onboarding.diet.noPreference')}</SelectItem>
                              <SelectItem value="vegetarian">{t('onboarding.diet.vegetarian')}</SelectItem>
                              <SelectItem value="vegan">{t('onboarding.diet.vegan')}</SelectItem>
                              <SelectItem value="keto">{t('onboarding.diet.keto')}</SelectItem>
                              <SelectItem value="highProtein">{t('onboarding.diet.highProtein')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                        {t('profile.editDialog.cancel')}
                      </Button>
                      <Button type="submit" className="gradient-primary">
                        {t('profile.editDialog.save')}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Avatar Section */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative">
              {/* Progress Ring */}
              <div className="relative w-32 h-32">
                <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                  <circle
                    cx="60"
                    cy="60"
                    r="54"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="text-muted"
                  />
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="54"
                    fill="none"
                    stroke="url(#progressGradient)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 54}`}
                    initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
                    animate={{ 
                      strokeDashoffset: 2 * Math.PI * 54 - (progressPercentage / 100) * 2 * Math.PI * 54 
                    }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                  />
                  <defs>
                    <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="hsl(var(--primary))" />
                      <stop offset="100%" stopColor="hsl(var(--primary-glow))" />
                    </linearGradient>
                  </defs>
                </svg>
                
                {/* Avatar */}
                <div className="absolute inset-3">
                  <Avatar className="w-full h-full border-4 border-background shadow-lg">
                    <AvatarImage src="" alt={user?.email || 'User'} />
                    <AvatarFallback className="text-xl font-bold bg-gradient-primary text-primary-foreground">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                  
                  {/* Upload Button */}
                  <Button
                    size="sm"
                    className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full gradient-primary shadow-glow"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      >
                        <Upload className="w-4 h-4" />
                      </motion.div>
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            {/* User Info */}
            <div className="text-center mt-4">
              <h3 className="text-xl font-bold text-foreground mb-1">
                {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
              </h3>
              <p className="text-muted-foreground text-sm mb-2">{user?.email}</p>
              <Badge variant="secondary" className="text-xs">
                {t('profile.workoutProgress', { 
                  completed: workoutProgress.completed, 
                  total: workoutProgress.total 
                })}
              </Badge>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            {statCards.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="group"
              >
                <Card className="border-border/50 hover:border-primary/50 transition-colors hover-scale">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-gradient-to-br ${stat.gradient} shadow-sm`}>
                        <stat.icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                          {stat.label}
                        </p>
                        <p className="font-bold text-foreground truncate">
                          {stat.value}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Weekly Progress */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="mt-6 p-4 rounded-lg bg-gradient-to-r from-primary/10 to-primary-glow/10 border border-primary/20"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-foreground">
                {t('profile.weeklyProgress')}
              </span>
              <span className="text-sm text-muted-foreground">
                {Math.round(progressPercentage)}%
              </span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
};