import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  firstName: z.string().min(2).max(50),
  age: z.number().int().min(13).max(120),
  weight: z.number().int().min(30).max(300),
  height: z.number().int().min(100).max(250),
  goal: z.enum(["gainMuscle", "loseFat", "improveCardio", "maintain"]),
  diet: z.enum(["vegan", "vegetarian", "keto", "highProtein", "noPreference"]),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  // Training preferences a coach needs. Required for new submissions; profiles
  // created before this step existed simply do not carry them.
  equipment: equipmentSchema,
  daysPerWeek: daysPerWeekSchema,
  sessionMinutes: sessionMinutesSchema
});

type OnboardingValues = z.infer<typeof onboardingSchema>;
const resolveOnboarding = zodResolver(onboardingSchema);

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
    // Localize at the resolver boundary, including messages from shared schemas.
    // The schema still owns every constraint; profile validation is unaffected.
    resolver: async (values, context, options) => {
      const result = await resolveOnboarding(values, context, options);
      for (const field of Object.keys(result.errors) as (keyof OnboardingValues)[]) {
        const error = result.errors[field];
        if (!error) continue;
        const value = values[field];
        const code = value === undefined || value === "" || Number.isNaN(value)
          ? "required"
          : error.type;
        error.message = t(`onboarding.validation.${field}.${code}`, {
          defaultValue: t(`onboarding.validation.${field}.invalid`),
        });
      }
      return result;
    },
    mode: "onChange"
  });

  const formData = watch();
  const totalSteps = 4;
  const progressText = t('onboarding.progress', { current: step, total: totalSteps });
  const errorProps = (field: keyof OnboardingValues) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `onboarding-${field}-error` : undefined,
  });

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

      toast.success(t('onboarding.saveSuccess'));
      onComplete();
    } catch (error: any) {
      toast.error(t('onboarding.saveError'));
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
    <div className="min-h-screen bg-background flex items-center justify-center p-3 sm:p-6">
      <Card className="w-full max-w-2xl gradient-card border-primary/20 shadow-card">
        <CardHeader className="text-center">
          <h1 className="text-3xl font-bold mb-2">{t('onboarding.title')}</h1>
          <p className="text-muted-foreground">{t('onboarding.description')}</p>
          <div className="mt-6">
            <Progress value={progress} aria-label={t('onboarding.progressLabel')}
              aria-valuenow={step} aria-valuemin={0} aria-valuemax={totalSteps}
              aria-valuetext={progressText} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">{progressText}</p>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.personalInfo')}</h2>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="firstName">{t('onboarding.fields.firstName')}</Label>
                  <Input
                    id="firstName"
                    {...errorProps("firstName")}
                    type="text"
                    placeholder={t('onboarding.fields.firstNamePlaceholder')}
                    {...register("firstName")}
                    className="mt-1"
                  />
                  {errors.firstName && (
                    <p id="onboarding-firstName-error" className="text-sm text-destructive mt-1">{errors.firstName.message}</p>
                  )}
                </div>
                
                <div>
                  <Label htmlFor="age">{t('onboarding.fields.age')}</Label>
                  <Input
                    id="age"
                    {...errorProps("age")}
                    type="number"
                    placeholder={t('onboarding.fields.agePlaceholder')}
                    {...register("age", { valueAsNumber: true })}
                    className="mt-1"
                  />
                  {errors.age && (
                    <p id="onboarding-age-error" className="text-sm text-destructive mt-1">{errors.age.message}</p>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="weight">{t('onboarding.fields.weight')}</Label>
                    <Input
                      id="weight"
                      {...errorProps("weight")}
                      type="number"
                      placeholder={t('onboarding.fields.weightPlaceholder')}
                      {...register("weight", { valueAsNumber: true })}
                      className="mt-1"
                    />
                    {errors.weight && (
                      <p id="onboarding-weight-error" className="text-sm text-destructive mt-1">{errors.weight.message}</p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="height">{t('onboarding.fields.height')}</Label>
                    <Input
                      id="height"
                      {...errorProps("height")}
                      type="number"
                      placeholder={t('onboarding.fields.heightPlaceholder')}
                      {...register("height", { valueAsNumber: true })}
                      className="mt-1"
                    />
                    {errors.height && (
                      <p id="onboarding-height-error" className="text-sm text-destructive mt-1">{errors.height.message}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.goals')}</h2>
              
              <div>
                <Label id="onboarding-goal-label">{t('onboarding.fields.fitnessGoal')}</Label>
                <RadioGroup
                  aria-labelledby="onboarding-goal-label"
                  {...errorProps("goal")}
                  value={formData.goal} 
                  onValueChange={(value) => setValue("goal", value as OnboardingValues["goal"], { shouldValidate: true })}
                  className="mt-3"
                >
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="gainMuscle" id="gainMuscle" />
                    <Label htmlFor="gainMuscle" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.gainMuscle')}</div>
                      <div className="text-sm text-muted-foreground">{t('onboarding.goalDescriptions.gainMuscle')}</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="loseFat" id="loseFat" />
                    <Label htmlFor="loseFat" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.loseFat')}</div>
                      <div className="text-sm text-muted-foreground">{t('onboarding.goalDescriptions.loseFat')}</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="improveCardio" id="improveCardio" />
                    <Label htmlFor="improveCardio" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.improveCardio')}</div>
                      <div className="text-sm text-muted-foreground">{t('onboarding.goalDescriptions.improveCardio')}</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="maintain" id="maintain" />
                    <Label htmlFor="maintain" className="cursor-pointer flex-1">
                      <div className="font-medium">{t('onboarding.goals.maintain')}</div>
                      <div className="text-sm text-muted-foreground">{t('onboarding.goalDescriptions.maintain')}</div>
                    </Label>
                  </div>
                </RadioGroup>
                {errors.goal && (
                  <p id="onboarding-goal-error" className="text-sm text-destructive mt-1">{errors.goal.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.dietAndExperience')}</h2>
              
              <div>
                <Label htmlFor="onboarding-diet">{t('onboarding.fields.dietaryPreference')}</Label>
                <Select value={formData.diet} onValueChange={(value) => setValue("diet", value as OnboardingValues["diet"], { shouldValidate: true })}>
                  <SelectTrigger id="onboarding-diet" {...errorProps("diet")} className="mt-1 h-auto min-h-10 [&>span]:line-clamp-none [&>span]:text-left">
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
                  <p id="onboarding-diet-error" className="text-sm text-destructive mt-1">{errors.diet.message}</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="onboarding-experience">{t('onboarding.fields.experience')}</Label>
                <Select value={formData.experience} onValueChange={(value) => setValue("experience", value as OnboardingValues["experience"], { shouldValidate: true })}>
                  <SelectTrigger id="onboarding-experience" {...errorProps("experience")} className="mt-1 h-auto min-h-10 [&>span]:line-clamp-none [&>span]:text-left">
                    <SelectValue placeholder={t('onboarding.fields.experiencePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">{t('dashboard.experienceLevel.beginner')}</SelectItem>
                    <SelectItem value="intermediate">{t('dashboard.experienceLevel.intermediate')}</SelectItem>
                    <SelectItem value="advanced">{t('dashboard.experienceLevel.advanced')}</SelectItem>
                  </SelectContent>
                </Select>
                {errors.experience && (
                  <p id="onboarding-experience-error" className="text-sm text-destructive mt-1">{errors.experience.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.training')}</h2>

              <div>
                <Label id="onboarding-equipment-label">{t('onboarding.fields.equipment')}</Label>
                <p id="onboarding-equipment-hint" className="text-sm text-muted-foreground mt-1 mb-3">
                  {t('onboarding.fields.equipmentHint')}
                </p>
                <div role="group" aria-labelledby="onboarding-equipment-label"
                  {...errorProps("equipment")}
                  aria-describedby={`onboarding-equipment-hint${errors.equipment ? " onboarding-equipment-error" : ""}`}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                  <p id="onboarding-equipment-error" className="text-sm text-destructive mt-2">{errors.equipment.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="onboarding-days">{t('onboarding.fields.daysPerWeek')}</Label>
                <Select
                  value={formData.daysPerWeek ? String(formData.daysPerWeek) : undefined}
                  onValueChange={(value) =>
                    setValue("daysPerWeek", Number(value), { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="onboarding-days" {...errorProps("daysPerWeek")} className="mt-1 h-auto min-h-10 [&>span]:line-clamp-none [&>span]:text-left">
                    <SelectValue placeholder={t('onboarding.fields.daysPerWeekPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {dayChoices.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {t('onboarding.days', { count: days })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.daysPerWeek && (
                  <p id="onboarding-daysPerWeek-error" className="text-sm text-destructive mt-1">{errors.daysPerWeek.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="onboarding-session">{t('onboarding.fields.sessionMinutes')}</Label>
                <Select
                  value={formData.sessionMinutes ? String(formData.sessionMinutes) : undefined}
                  onValueChange={(value) =>
                    setValue("sessionMinutes", Number(value), { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="onboarding-session" {...errorProps("sessionMinutes")} className="mt-1 h-auto min-h-10 [&>span]:line-clamp-none [&>span]:text-left">
                    <SelectValue placeholder={t('onboarding.fields.sessionMinutesPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_MINUTES_CHOICES.map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {t('onboarding.minutes', { count: minutes })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.sessionMinutes && (
                  <p id="onboarding-sessionMinutes-error" className="text-sm text-destructive mt-1">{errors.sessionMinutes.message}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-3 pt-6">
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
              {loading ? t('onboarding.buttons.saving') : (step === totalSteps ? t('onboarding.buttons.complete') : t('onboarding.buttons.next'))}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OnboardingForm;
