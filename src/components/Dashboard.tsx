import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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

const Dashboard = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('dashboard.welcome')}</h1>
            <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
          </div>
          <Button className="gradient-primary text-primary-foreground shadow-glow">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('dashboard.regenerate.button')}
          </Button>
        </div>

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
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Week 1 Progress</span>
                    <Badge variant="secondary">5/7 Complete</Badge>
                  </div>
                  <Progress value={71} className="h-2" />
                  
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">{t('dashboard.workoutPlan.comingSoon')}</p>
                  </div>
                </div>
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
                <div className="text-center py-8">
                  <p className="text-muted-foreground">{t('dashboard.nutritionPlan.comingSoon')}</p>
                </div>
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
                      <div className="mt-1 p-3 bg-muted rounded-lg">28 years</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.weight')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">75 kg</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.height')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">180 cm</div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.fitnessGoal')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">{t('onboarding.goals.gainMuscle')}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('onboarding.fields.dietaryPreference')}</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">{t('onboarding.diet.highProtein')}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Experience Level</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">Intermediate</div>
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
    </div>
  );
};

export default Dashboard;