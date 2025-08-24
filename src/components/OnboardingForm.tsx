import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, ArrowLeft } from "lucide-react";

const OnboardingForm = ({ onComplete }: { onComplete: () => void }) => {
  const [step, setStep] = useState(1);
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

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete();
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
          <CardTitle className="text-3xl font-bold mb-2">Let's Get You Started</CardTitle>
          <p className="text-muted-foreground">Help us create your personalized fitness plan</p>
          <div className="mt-6">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">Step {step} of {totalSteps}</p>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">Basic Information</h3>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="age">Age</Label>
                  <Input
                    id="age"
                    type="number"
                    placeholder="Enter your age"
                    value={formData.age}
                    onChange={(e) => setFormData({...formData, age: e.target.value})}
                    className="mt-1"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="weight">Weight (kg)</Label>
                    <Input
                      id="weight"
                      type="number"
                      placeholder="Enter your weight"
                      value={formData.weight}
                      onChange={(e) => setFormData({...formData, weight: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="height">Height (cm)</Label>
                    <Input
                      id="height"
                      type="number"
                      placeholder="Enter your height"
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
              <h3 className="text-xl font-semibold text-center mb-6">Fitness Goals</h3>
              
              <div>
                <Label>What's your primary fitness goal?</Label>
                <RadioGroup 
                  value={formData.goal} 
                  onValueChange={(value) => setFormData({...formData, goal: value})}
                  className="mt-3"
                >
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="gain-muscle" id="gain-muscle" />
                    <Label htmlFor="gain-muscle" className="cursor-pointer flex-1">
                      <div className="font-medium">Gain Muscle</div>
                      <div className="text-sm text-muted-foreground">Build strength and muscle mass</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="lose-fat" id="lose-fat" />
                    <Label htmlFor="lose-fat" className="cursor-pointer flex-1">
                      <div className="font-medium">Lose Fat</div>
                      <div className="text-sm text-muted-foreground">Reduce body fat and get lean</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="improve-cardio" id="improve-cardio" />
                    <Label htmlFor="improve-cardio" className="cursor-pointer flex-1">
                      <div className="font-medium">Improve Cardio</div>
                      <div className="text-sm text-muted-foreground">Enhance cardiovascular endurance</div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-4 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                    <RadioGroupItem value="maintain" id="maintain" />
                    <Label htmlFor="maintain" className="cursor-pointer flex-1">
                      <div className="font-medium">Maintain</div>
                      <div className="text-sm text-muted-foreground">Stay fit and healthy</div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-center mb-6">Preferences & Experience</h3>
              
              <div>
                <Label>Dietary Preference</Label>
                <Select value={formData.diet} onValueChange={(value) => setFormData({...formData, diet: value})}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select your dietary preference" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-preference">No Preference</SelectItem>
                    <SelectItem value="vegetarian">Vegetarian</SelectItem>
                    <SelectItem value="vegan">Vegan</SelectItem>
                    <SelectItem value="keto">Keto</SelectItem>
                    <SelectItem value="high-protein">High-Protein</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label>Experience Level</Label>
                <Select value={formData.experience} onValueChange={(value) => setFormData({...formData, experience: value})}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select your experience level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner (0-6 months)</SelectItem>
                    <SelectItem value="intermediate">Intermediate (6 months - 2 years)</SelectItem>
                    <SelectItem value="advanced">Advanced (2+ years)</SelectItem>
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
              Back
            </Button>
            
            <Button 
              onClick={handleNext}
              className="gradient-primary text-primary-foreground shadow-glow flex items-center gap-2"
            >
              {step === totalSteps ? "Generate Plan" : "Next"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OnboardingForm;