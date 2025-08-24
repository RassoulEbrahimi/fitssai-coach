import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Dumbbell, Apple, Target, TrendingUp, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

const Features = () => {
  const { t } = useTranslation();
  
  const features = [
    {
      icon: Brain,
      title: t('features.aiPlans.title'),
      description: t('features.aiPlans.description')
    },
    {
      icon: Dumbbell,
      title: t('features.customWorkouts.title'),
      description: t('features.customWorkouts.description')
    },
    {
      icon: Apple,
      title: t('features.smartNutrition.title'),
      description: t('features.smartNutrition.description')
    },
    {
      icon: Target,
      title: t('features.goalTracking.title'),
      description: t('features.goalTracking.description')
    },
    {
      icon: TrendingUp,
      title: t('features.progressAnalytics.title'),
      description: t('features.progressAnalytics.description')
    },
    {
      icon: Users,
      title: t('features.communitySupport.title'),
      description: t('features.communitySupport.description')
    }
  ];

  return (
    <section id="features" className="py-24 bg-gradient-card">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            {t('features.title').split('Advanced AI')[0]}
            <span className="gradient-primary bg-clip-text text-transparent">Advanced AI</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            {t('features.description')}
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