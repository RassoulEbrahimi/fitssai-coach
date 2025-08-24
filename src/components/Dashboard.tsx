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

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Welcome back, Alex!</h1>
            <p className="text-muted-foreground">Ready to crush your fitness goals today?</p>
          </div>
          <Button className="gradient-primary text-primary-foreground shadow-glow">
            <RefreshCw className="mr-2 h-4 w-4" />
            Regenerate Plans
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
          <TabsList className="grid w-full md:w-fit grid-cols-3 md:grid-cols-4 bg-card border border-border">
            <TabsTrigger value="workout" className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" />
              Workouts
            </TabsTrigger>
            <TabsTrigger value="nutrition" className="flex items-center gap-2">
              <Apple className="h-4 w-4" />
              Nutrition
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Profile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workout" className="space-y-6">
            <Card className="gradient-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Dumbbell className="h-5 w-5 text-primary" />
                  Your 4-Week Workout Plan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Week 1 Progress</span>
                    <Badge variant="secondary">5/7 Complete</Badge>
                  </div>
                  <Progress value={71} className="h-2" />
                  
                  <div className="grid gap-4 mt-6">
                    {[
                      { day: "Monday", exercise: "Upper Body Strength", duration: "45 min", status: "completed" },
                      { day: "Tuesday", exercise: "Cardio HIIT", duration: "30 min", status: "completed" },
                      { day: "Wednesday", exercise: "Lower Body Power", duration: "50 min", status: "completed" },
                      { day: "Thursday", exercise: "Active Recovery", duration: "20 min", status: "completed" },
                      { day: "Friday", exercise: "Full Body Circuit", duration: "40 min", status: "completed" },
                      { day: "Saturday", exercise: "Core & Flexibility", duration: "25 min", status: "pending" },
                      { day: "Sunday", exercise: "Rest Day", duration: "-", status: "pending" }
                    ].map((workout, index) => (
                      <div key={index} className="flex items-center justify-between p-4 rounded-lg border border-border">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="font-medium">{workout.day}</span>
                            <span className="text-sm text-muted-foreground">{workout.exercise}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">{workout.duration}</span>
                          <Badge variant={workout.status === "completed" ? "default" : "outline"}>
                            {workout.status === "completed" ? "✓" : "○"}
                          </Badge>
                        </div>
                      </div>
                    ))}
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
                  Today's Nutrition Plan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 rounded-lg border border-border">
                      <div className="text-2xl font-bold text-primary">2,200</div>
                      <div className="text-sm text-muted-foreground">Calories</div>
                    </div>
                    <div className="text-center p-4 rounded-lg border border-border">
                      <div className="text-2xl font-bold text-primary">165g</div>
                      <div className="text-sm text-muted-foreground">Protein</div>
                    </div>
                    <div className="text-center p-4 rounded-lg border border-border">
                      <div className="text-2xl font-bold text-primary">275g</div>
                      <div className="text-sm text-muted-foreground">Carbs</div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {[
                      { meal: "Breakfast", food: "Oatmeal with berries and protein powder", calories: "450", time: "7:00 AM" },
                      { meal: "Lunch", food: "Grilled chicken salad with quinoa", calories: "650", time: "12:30 PM" },
                      { meal: "Snack", food: "Greek yogurt with almonds", calories: "200", time: "3:00 PM" },
                      { meal: "Dinner", food: "Salmon with sweet potato and broccoli", calories: "700", time: "7:00 PM" },
                      { meal: "Evening", food: "Casein protein shake", calories: "200", time: "9:30 PM" }
                    ].map((meal, index) => (
                      <div key={index} className="flex items-center justify-between p-4 rounded-lg border border-border">
                        <div className="flex flex-col">
                          <span className="font-medium">{meal.meal}</span>
                          <span className="text-sm text-muted-foreground">{meal.food}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{meal.calories} cal</div>
                          <div className="text-sm text-muted-foreground">{meal.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <Card className="gradient-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Your Profile
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Age</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">28 years</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Weight</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">75 kg</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Height</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">180 cm</div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Fitness Goal</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">Gain Muscle</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Dietary Preference</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">High-Protein</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Experience Level</label>
                      <div className="mt-1 p-3 bg-muted rounded-lg">Intermediate</div>
                    </div>
                  </div>
                </div>
                <div className="mt-6">
                  <Button className="gradient-primary text-primary-foreground">
                    Update Profile
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