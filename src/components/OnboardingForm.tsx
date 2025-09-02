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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const OnboardingForm = ({ onComplete }: { onComplete: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    age: "",
    weight: "",
    height: "",
    goal: "",
    diet: "",
    experience: ""
  });

  const totalSteps = 3;
  const progress = (step / totalSteps) * 100;

  const handleNext = async () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      await saveProfile();
    }
  };

  const saveProfile = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          age: parseInt(formData.age),
          weight: parseInt(formData.weight),
          height: parseInt(formData.height),
          fitness_goal: formData.goal,
          dietary_preference: formData.diet,
          experience_level: formData.experience,
        });

      if (error) throw error;

      toast.success('Profile saved successfully!');
      onComplete();
    } catch (error: any) {
      console.error('Error saving profile:', error);
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
                  <Label htmlFor="age">{t('onboarding.fields.age')}</Label>
                  <Input
                    id="age"
                    type="number"
                    placeholder={t('onboarding.fields.agePlaceholder')}
                    value={formData.age}
                    onChange={(e) => setFormData({...formData, age: e.target.value})}
                    className="mt-1"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="weight">{t('onboarding.fields.weight')}</Label>
                    <Input
                      id="weight"
                      type="number"
                      placeholder={t('onboarding.fields.weightPlaceholder')}
                      value={formData.weight}
                      onChange={(e) => setFormData({...formData, weight: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="height">{t('onboarding.fields.height')}</Label>
                    <Input
                      id="height"
                      type="number"
                      placeholder={t('onboarding.fields.heightPlaceholder')}
                      value={formData.height}
                      onChange={(e) => setFormData({...formData, height: e.target.value})}
                      className="mt-1"
                    />
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
                  onValueChange={(value) => setFormData({...formData, goal: value})}
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
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">{t('onboarding.steps.review')}</h3>
              
              <div>
                <Label>{t('onboarding.fields.dietaryPreference')}</Label>
                <Select value={formData.diet} onValueChange={(value) => setFormData({...formData, diet: value})}>
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
              </div>
              
              <div>
                <Label>{t('dashboard.experienceLevel.label')}</Label>
                <Select value={formData.experience} onValueChange={(value) => setFormData({...formData, experience: value})}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('dashboard.experienceLevel.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">{t('dashboard.experienceLevel.beginnerDesc')}</SelectItem>
                    <SelectItem value="intermediate">{t('dashboard.experienceLevel.intermediateDesc')}</SelectItem>
                    <SelectItem value="advanced">{t('dashboard.experienceLevel.advancedDesc')}</SelectItem>
                  </SelectContent>
                </Select>
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