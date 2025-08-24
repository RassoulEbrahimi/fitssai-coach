import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Dumbbell, Apple, Target, TrendingUp, Users } from "lucide-react";

const Features = () => {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered Plans",
      description: "Advanced AI analyzes your profile to create personalized workout and nutrition plans tailored to your unique needs and goals."
    },
    {
      icon: Dumbbell,
      title: "Custom Workouts",
      description: "Get detailed 4-week workout programs with specific exercises, sets, reps, and progression tracking for optimal results."
    },
    {
      icon: Apple,
      title: "Smart Nutrition",
      description: "Receive personalized meal plans and nutrition guidance based on your dietary preferences and fitness objectives."
    },
    {
      icon: Target,
      title: "Goal Tracking",
      description: "Set and achieve your fitness goals with intelligent progress tracking and adaptive plan adjustments."
    },
    {
      icon: TrendingUp,
      title: "Progress Analytics",
      description: "Monitor your improvement with detailed analytics and insights to stay motivated and on track."
    },
    {
      icon: Users,
      title: "Community Support",
      description: "Connect with like-minded fitness enthusiasts and get support from our active community."
    }
  ];

  return (
    <section id="features" className="py-24 bg-gradient-card">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Powered by <span className="gradient-primary bg-clip-text text-transparent">Advanced AI</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Experience the future of fitness with intelligent features designed to accelerate your transformation
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <Card 
              key={index} 
              className="gradient-card border-primary/20 shadow-card hover:shadow-glow transition-smooth group"
            >
              <CardHeader>
                <div className="gradient-primary p-3 rounded-lg w-fit mb-4 group-hover:shadow-glow transition-smooth">
                  <feature.icon className="h-6 w-6 text-primary-foreground" />
                </div>
                <CardTitle className="text-xl mb-2">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;