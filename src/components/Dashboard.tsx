import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dumbbell, 
  Apple, 
  User, 
  RefreshCw, 
  Calendar, 
  Clock,
  TrendingUp,
  Target,
  Flame
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";

const Dashboard = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [workoutPlan, setWorkoutPlan] = useState<any>(null);
  const [nutritionPlan, setNutritionPlan] = useState<any>(null);
  const [generatingPlans, setGeneratingPlans] = useState(false);
  const [dailyQuote, setDailyQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(true);
  
  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchPlans();
      fetchDailyQuote();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchDailyQuote();
    }
  }, [i18n.language]);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlans = async () => {
    if (!user) return;

    try {
      // Fetch latest workout plan
      const { data: workoutData } = await supabase
        .from('workout_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      // Fetch latest nutrition plan
      const { data: nutritionData } = await supabase
        .from('nutrition_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      setWorkoutPlan(workoutData?.[0] || null);
      setNutritionPlan(nutritionData?.[0] || null);
    } catch (error) {
      console.error('Error fetching plans:', error);
    }
  };

  const fetchDailyQuote = async (forceRefresh = false) => {
    if (!user) return;

    setLoadingQuote(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-daily-quote', {
        body: { 
          language: i18n.language,
          forceRefresh 
        },
      });

      if (error) throw error;
      setDailyQuote(data);
    } catch (error) {
      console.error('Error fetching daily quote:', error);
      setDailyQuote({
        quote: i18n.language === 'fa' 
          ? 'هر روز فرصتی جدید برای بهتر شدن است.'
          : 'Every day is a new opportunity to become better.',
        author: 'FitssAI',
        language: i18n.language
      });
    } finally {
      setLoadingQuote(false);
    }
  };

  const generatePlans = async () => {
    if (!user) return;

    setGeneratingPlans(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-plans', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Plans generated successfully!');
        await fetchPlans(); // Refresh the plans
      } else {
        throw new Error(data.error || 'Failed to generate plans');
      }
    } catch (error) {
      console.error('Error generating plans:', error);
      toast.error('Failed to generate plans. Please try again.');
    } finally {
      setGeneratingPlans(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xl">Loading your profile...</div>
      </div>
    );
  }
  
  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('dashboard.welcome')}</h1>
            <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button 
              className="gradient-primary text-primary-foreground shadow-glow" 
              onClick={generatePlans}
              disabled={generatingPlans}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${generatingPlans ? 'animate-spin' : ''}`} />
              {generatingPlans ? 'Generating...' : (workoutPlan || nutritionPlan ? 'Regenerate Plans' : 'Generate Plans')}
            </Button>
          </div>
        </div>

        {/* Daily Quote */}
        <Card className="gradient-card border-primary/20 mb-8">
          <CardContent className="p-6">
            <div className={`flex items-start justify-between ${i18n.language === 'fa' ? 'flex-row-reverse' : ''}`}>
              <div className={`flex-1 ${i18n.language === 'fa' ? 'text-right' : 'text-left'}`}>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <span>💡</span>
                  <span>{i18n.language === 'fa' ? 'نقل قول روز' : 'Quote of the Day'}</span>
                </h3>
                {loadingQuote ? (
                  <div className="animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                ) : (
                  <div className={`${i18n.language === 'fa' ? 'rtl' : 'ltr'}`}>
                    <p className="text-foreground mb-2 italic text-lg leading-relaxed">
                      "{dailyQuote?.quote}"
                    </p>
                    <p className="text-muted-foreground text-sm">
                      — {dailyQuote?.author}
                    </p>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchDailyQuote(true)}
                disabled={loadingQuote}
                className={`${i18n.language === 'fa' ? 'ml-4' : 'mr-4'} shrink-0`}
              >
                <RefreshCw className={`h-4 w-4 ${loadingQuote ? 'animate-spin' : ''} ${i18n.language === 'fa' ? 'ml-2' : 'mr-2'}`} />
                {i18n.language === 'fa' ? 'تجدید' : 'Refresh'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="gradient-card border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Current Streak</p>
                  <p className="text-2xl font-bold text-primary">12 days</p>
                </div>
                <Flame className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="gradient-card border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Weekly Goal</p>
                  <p className="text-2xl font-bold text-primary">4/5</p>
                </div>
                <Target className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="gradient-card border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Calories Burned</p>
                  <p className="text-2xl font-bold text-primary">2,450</p>
                </div>
                <TrendingUp className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="gradient-card border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Next Workout</p>
                  <p className="text-2xl font-bold text-primary">Today</p>
                </div>
                <Clock className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="workout" className="space-y-6">
          <TabsList className="grid w-full md:w-fit grid-cols-3 md:grid-cols-3 bg-card border border-border">
            <TabsTrigger value="workout" className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" />
              {t('dashboard.tabs.workoutPlan')}
            </TabsTrigger>
            <TabsTrigger value="nutrition" className="flex items-center gap-2">
              <Apple className="h-4 w-4" />
              {t('dashboard.tabs.nutritionPlan')}
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              {t('dashboard.tabs.profile')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workout" className="space-y-6">
            <Card className="gradient-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Dumbbell className="h-5 w-5 text-primary" />
                  {t('dashboard.workoutPlan.title')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {workoutPlan ? (
                  <div className="space-y-6">
                    {Object.entries(workoutPlan.content).map(([week, days]: [string, any]) => (
                      <div key={week} className="space-y-4">
                        <h3 className="text-lg font-semibold capitalize text-primary">
                          {week.replace(/([A-Z])/g, ' $1').trim()}
                        </h3>
                        <div className="grid gap-4">
                          {days.map((day: any, dayIndex: number) => (
                            <Card key={dayIndex} className="border-primary/10">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-base">{day.day}</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-2">
                                  {day.exercises.map((exercise: any, exerciseIndex: number) => (
                                    <div key={exerciseIndex} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                                      <div>
                                        <span className="font-medium">{exercise.name}</span>
                                      </div>
                                      <div className="text-sm text-muted-foreground">
                                        {exercise.sets} sets × {exercise.reps} • {exercise.rest}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      No workout plan generated yet. Click "Generate Plans" to create your personalized plan.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="nutrition" className="space-y-6">
            <Card className="gradient-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Apple className="h-5 w-5 text-primary" />
                  {t('dashboard.nutritionPlan.title')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {nutritionPlan ? (
                  <div className="space-y-6">
                    {Object.entries(nutritionPlan.content).map(([mealType, meals]: [string, any]) => (
                      <div key={mealType} className="space-y-3">
                        <h3 className="text-lg font-semibold capitalize text-primary">{mealType}</h3>
                        <div className="grid gap-3">
                          {meals.map((meal: any, mealIndex: number) => (
                            <Card key={mealIndex} className="border-primary/10">
                              <CardContent className="p-4">
                                <div className="flex justify-between items-start">
                                  <div className="flex-1">
                                    <h4 className="font-medium">{meal.meal}</h4>
                                    <p className="text-sm text-muted-foreground mt-1">{meal.description}</p>
                                  </div>
                                  <Badge variant="secondary" className="ml-3">
                                    {meal.calories} cal
                                  </Badge>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      No nutrition plan generated yet. Click "Generate Plans" to create your personalized plan.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <Card className="gradient-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  {t('dashboard.profile.title')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.age')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">{profile?.age} years</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.weight')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">{profile?.weight} kg</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.height')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">{profile?.height} cm</div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.fitnessGoal')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">
                        {profile?.fitness_goal === 'gain-muscle' && t('onboarding.goals.gainMuscle')}
                        {profile?.fitness_goal === 'lose-fat' && t('onboarding.goals.loseFat')}
                        {profile?.fitness_goal === 'improve-cardio' && t('onboarding.goals.improveCardio')}
                        {profile?.fitness_goal === 'maintain' && t('onboarding.goals.maintain')}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.dietaryPreference')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">
                        {profile?.dietary_preference === 'no-preference' && t('onboarding.diet.noPreference')}
                        {profile?.dietary_preference === 'vegetarian' && t('onboarding.diet.vegetarian')}
                        {profile?.dietary_preference === 'vegan' && t('onboarding.diet.vegan')}
                        {profile?.dietary_preference === 'keto' && t('onboarding.diet.keto')}
                        {profile?.dietary_preference === 'high-protein' && t('onboarding.diet.highProtein')}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Experience Level</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">
                        {profile?.experience_level === 'beginner' && 'Beginner'}
                        {profile?.experience_level === 'intermediate' && 'Intermediate'}
                        {profile?.experience_level === 'advanced' && 'Advanced'}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-6">
                  <Button className="gradient-primary text-primary-foreground">
                    {t('dashboard.profile.edit')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    );
  };

export default Dashboard;