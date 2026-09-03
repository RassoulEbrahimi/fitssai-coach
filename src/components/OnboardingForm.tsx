import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  EQUIPMENT_OPTIONS,
  SESSION_MINUTES_CHOICES,
  DAYS_PER_WEEK_MIN,
  DAYS_PER_WEEK_MAX,
  daysPerWeekSchema,
  equipmentSchema,
  sessionMinutesSchema,
  type EquipmentType,
} from "@/lib/coachingPreferences";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateProfile } from "@/hooks/queries/useProfile";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const onboardingSchema = z.object({
  firstName: z.string().min(2, "Name must be at least 2 characters").max(50, "Name too long"),
  age: z.number({ invalid_type_error: "Age is required" }).int().min(13, "Must be at least 13").max(120, "Invalid age"),
  weight: z.number({ invalid_type_error: "Weight is required" }).int().min(30, "Weight must be at least 30kg").max(300, "Invalid weight"),
  height: z.number({ invalid_type_error: "Height is required" }).int().min(100, "Height must be at least 100cm").max(250, "Invalid height"),
  goal: z.enum(["gainMuscle", "loseFat", "improveCardio", "maintain"], { required_error: "Please select a goal" }),
  diet: z.enum(["vegan", "vegetarian", "keto", "highProtein", "noPreference"], { required_error: "Please select a dietary preference" }),
  experience: z.enum(["beginner", "intermediate", "advanced"], { required_error: "Please select experience level" }),
  // Training preferences a coach needs. Required for new submissions; profiles
  // created before this step existed simply do not carry them.
  equipment: equipmentSchema,
  daysPerWeek: daysPerWeekSchema,
  sessionMinutes: sessionMinutesSchema
});

const OnboardingForm = ({ onComplete }: { onComplete: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  /*
    The same write path the profile screen uses. Onboarding used to call
    setDoc directly, which left the cached profile — the only thing the
    dashboard reads — holding the pre-onboarding entry after the redirect.
  */
  const { mutateAsync: saveProfileValues } = useUpdateProfile();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors }, trigger, setValue, watch } = useForm<z.infer<typeof onboardingSchema>>({
    resolver: zodResolver(onboardingSchema),
    mode: "onChange"
  });

  const formData = watch();
  const totalSteps = 4;

  /** 1..7, so every allowed value is selectable. */
  const dayChoices = Array.from(
    { length: DAYS_PER_WEEK_MAX - DAYS_PER_WEEK_MIN + 1 },
    (_, index) => DAYS_PER_WEEK_MIN + index
  );

  const toggleEquipment = (id: EquipmentType) => {
    const current = formData.equipment ?? [];
    const next = current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id];
    setValue("equipment", next, { shouldValidate: true });
  };
  const progress = (step / totalSteps) * 100;

  const handleNext = async () => {
    let fieldsToValidate: (keyof z.infer<typeof onboardingSchema>)[] = [];
    
    if (step === 1) {
      fieldsToValidate = ["firstName", "age", "weight", "height"];
    } else if (step === 2) {
      fieldsToValidate = ["goal"];
    } else if (step === 3) {
      fieldsToValidate = ["diet", "experience"];
    } else if (step === 4) {
      fieldsToValidate = ["equipment", "daysPerWeek", "sessionMinutes"];
    }

    const isValid = await trigger(fieldsToValidate);
    
    if (isValid) {
      if (step < totalSteps) {
        setStep(step + 1);
      } else {
        await handleSubmit(saveProfile)();
      }
    }
  };

  const saveProfile = async (data: z.infer<typeof onboardingSchema>) => {
    if (!user) return;

    setLoading(true);
    try {
      await saveProfileValues({
        full_name:          data.firstName,
        age:                data.age,
        weight:             data.weight,
        height:             data.height,
        fitness_goal:       data.goal,
        dietary_preference: data.diet,
        experience_level:   data.experience,
        equipment:          data.equipment,
        daysPerWeek:        data.daysPerWeek,
        sessionMinutes:     data.sessionMinutes,
      });

      toast.success('Profile saved successfully!');
      onComplete();
    } catch (error: any) {
      toast.error('Failed to save profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl gradient-card border-primary/20 shadow-card">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold mb-2">{t('onboarding.title')}</CardTitle>
          <p className="text-muted-foreground">{t('onboarding.description')}</p>
          <div className="mt-6">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">Step {step} of {totalSteps}</p>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.personalInfo')}</h3>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="firstName">Vorname</Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="Gib deinen Namen ein"
                    {...register("firstName")}
                    className="mt-1"
                  />
                  {errors.firstName && (
                    <p className="text-sm text-destructive mt-1">{errors.firstName.message}</p>
                  )}
                </div>
                
                <div>
                  <Label htmlFor="age">{t('onboarding.fields.age')}</Label>
                  <Input
                    id="age"
                    type="number"
                    placeholder={t('onboarding.fields.agePlaceholder')}
                    {...register("age", { valueAsNumber: true })}
                    className="mt-1"
                  />
                  {errors.age && (
                    <p className="text-sm text-destructive mt-1">{errors.age.message}</p>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="weight">{t('onboarding.fields.weight')}</Label>
                    <Input
                      id="weight"
                      type="number"
                      placeholder={t('onboarding.fields.weightPlaceholder')}
                      {...register("weight", { valueAsNumber: true })}
                      className="mt-1"
                    />
                    {errors.weight && (
                      <p className="text-sm text-destructive mt-1">{errors.weight.message}</p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="height">{t('onboarding.fields.height')}</Label>
                    <Input
                      id="height"
                      type="number"
                      placeholder={t('onboarding.fields.heightPlaceholder')}
                      {...register("height", { valueAsNumber: true })}
                      className="mt-1"
                    />
                    {errors.height && (
                      <p className="text-sm text-destructive mt-1">{errors.height.message}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.goals')}</h3>
              
              <div>
                <Label>{t('onboarding.fields.fitnessGoal')}</Label>
                <RadioGroup 
                  value={formData.goal} 
                  onValueChange={(value) => setValue("goal", value as any)}
                  className="mt-3"
                >
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="gainMuscle" id="gainMuscle" />
                    <Label htmlFor="gainMuscle" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.gainMuscle')}</div>
                      <div className="text-sm text-muted-foreground">Build strength and muscle mass</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="loseFat" id="loseFat" />
                    <Label htmlFor="loseFat" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.loseFat')}</div>
                      <div className="text-sm text-muted-foreground">Reduce body fat and get lean</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="improveCardio" id="improveCardio" />
                    <Label htmlFor="improveCardio" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.improveCardio')}</div>
                      <div className="text-sm text-muted-foreground">Enhance cardiovascular endurance</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="maintain" id="maintain" />
                    <Label htmlFor="maintain" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.maintain')}</div>
                      <div className="text-sm text-muted-foreground">Stay fit and healthy</div>
                    </Label>
                  </div>
                </RadioGroup>
                {errors.goal && (
                  <p className="text-sm text-destructive mt-1">{errors.goal.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.review')}</h3>
              
              <div>
                <Label>{t('onboarding.fields.dietaryPreference')}</Label>
                <Select value={formData.diet} onValueChange={(value) => setValue("diet", value as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('onboarding.fields.dietaryPreferencePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="noPreference">{t('onboarding.diet.noPreference')}</SelectItem>
                    <SelectItem value="vegetarian">{t('onboarding.diet.vegetarian')}</SelectItem>
                    <SelectItem value="vegan">{t('onboarding.diet.vegan')}</SelectItem>
                    <SelectItem value="keto">{t('onboarding.diet.keto')}</SelectItem>
                    <SelectItem value="highProtein">{t('onboarding.diet.highProtein')}</SelectItem>
                  </SelectContent>
                </Select>
                {errors.diet && (
                  <p className="text-sm text-destructive mt-1">{errors.diet.message}</p>
                )}
              </div>
              
              <div>
                <Label>{t('dashboard.experienceLevel.label')}</Label>
                <Select value={formData.experience} onValueChange={(value) => setValue("experience", value as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('dashboard.experienceLevel.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">{t('dashboard.experienceLevel.beginnerDesc')}</SelectItem>
                    <SelectItem value="intermediate">{t('dashboard.experienceLevel.intermediateDesc')}</SelectItem>
                    <SelectItem value="advanced">{t('dashboard.experienceLevel.advancedDesc')}</SelectItem>
                  </SelectContent>
                </Select>
                {errors.experience && (
                  <p className="text-sm text-destructive mt-1">{errors.experience.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">Dein Training</h3>

              <div>
                <Label>Verfügbare Ausrüstung</Label>
                <p className="text-sm text-muted-foreground mt-1 mb-3">
                  Mehrfachauswahl möglich.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {EQUIPMENT_OPTIONS.map((option) => {
                    const selected = (formData.equipment ?? []).includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleEquipment(option.id)}
                        className={`text-left rounded-xl border p-3 transition-colors min-h-[44px] ${
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        {option.hint && (
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            {option.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {errors.equipment && (
                  <p className="text-sm text-destructive mt-2">{errors.equipment.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="onboarding-days">Trainingstage pro Woche</Label>
                <Select
                  value={formData.daysPerWeek ? String(formData.daysPerWeek) : undefined}
                  onValueChange={(value) =>
                    setValue("daysPerWeek", Number(value), { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="onboarding-days" className="mt-1">
                    <SelectValue placeholder="Bitte auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {dayChoices.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {days} {days === 1 ? "Tag" : "Tage"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.daysPerWeek && (
                  <p className="text-sm text-destructive mt-1">{errors.daysPerWeek.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="onboarding-session">Gewünschte Trainingsdauer</Label>
                <Select
                  value={formData.sessionMinutes ? String(formData.sessionMinutes) : undefined}
                  onValueChange={(value) =>
                    setValue("sessionMinutes", Number(value), { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="onboarding-session" className="mt-1">
                    <SelectValue placeholder="Bitte auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_MINUTES_CHOICES.map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {minutes} Minuten
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.sessionMinutes && (
                  <p className="text-sm text-destructive mt-1">{errors.sessionMinutes.message}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-6">
            <Button 
              variant="outline" 
              onClick={handleBack}
              disabled={step === 1}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('onboarding.buttons.previous')}
            </Button>
            
            <Button 
              onClick={handleNext}
              disabled={loading}
              className="gradient-primary text-primary-foreground shadow-glow flex items-center gap-2"
            >
              {loading ? 'Saving...' : (step === totalSteps ? t('onboarding.buttons.complete') : t('onboarding.buttons.next'))}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OnboardingForm;