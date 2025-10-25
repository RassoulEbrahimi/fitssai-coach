import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Sparkles, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { useAIAnalytics } from '@/hooks/useAIAnalytics';

export const AIAnalyticsCard = () => {
  const { analytics, loading } = useAIAnalytics();

  if (loading) {
    return (
      <Card className="gradient-card border-primary/20 shadow-card animate-pulse">
        <CardContent className="p-6">
          <div className="h-64 bg-muted/20 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      icon: CheckCircle2,
      label: 'Erfolgreich',
      value: analytics.totalSuccess,
      color: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/20'
    },
    {
      icon: XCircle,
      label: 'Fehlgeschlagen',
      value: analytics.totalFail,
      color: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/20'
    },
    {
      icon: Zap,
      label: 'Ø Latenz',
      value: analytics.avgLatency > 0 ? `${analytics.avgLatency} ms` : '—',
      color: 'text-sky-400',
      bgColor: 'from-sky-500/20 to-sky-600/20'
    }
  ];

  const hasData = analytics.totalSuccess > 0 || analytics.totalFail > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="gradient-card border-primary/20 shadow-card overflow-hidden rounded-2xl">
        <CardContent className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-primary to-primary-glow shadow-glow">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-lg font-bold text-foreground tracking-tight">KI-Analysen</h3>
            </div>
          </div>

          {hasData ? (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {stats.map((stat, index) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                    className={`p-4 rounded-2xl bg-gradient-to-br ${stat.bgColor} border border-border/20 backdrop-blur-sm`}
                  >
                    <div className="flex flex-col items-center text-center">
                      <stat.icon className={`w-5 h-5 mb-2 ${stat.color}`} />
                      <span className={`text-xl font-bold ${stat.color} tracking-tight`}>
                        {stat.value}
                      </span>
                      <p className="text-xs text-muted-foreground mt-1 tracking-wide">
                        {stat.label}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Chart */}
              {analytics.dailyData.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="mt-4"
                >
                  <h4 className="text-sm font-semibold text-foreground mb-3 tracking-tight">
                    Letzte 7 Tage
                  </h4>
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/5 to-primary-glow/5 border border-primary/10 backdrop-blur-sm">
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={analytics.dailyData}>
                        <defs>
                          <linearGradient id="aiGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid 
                          strokeDasharray="3 3" 
                          stroke="hsl(var(--border))"
                          opacity={0.2}
                        />
                        <XAxis 
                          dataKey="day"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '12px',
                            boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.2)'
                          }}
                          labelStyle={{ color: 'hsl(var(--foreground))' }}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          strokeWidth={3}
                          fill="url(#aiGradient)"
                          dot={{ 
                            fill: 'hsl(var(--primary))',
                            r: 4,
                            strokeWidth: 2,
                            stroke: 'hsl(var(--background))'
                          }}
                          activeDot={{ r: 6, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    {analytics.totalSuccess} AI-generierte Trainingsvorschläge diese Woche ✅
                  </p>
                </motion.div>
              )}
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-8 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary-glow/20 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                Noch keine KI-Aktivität
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Nutze die KI-Vorschläge, um hier Daten zu sehen
              </p>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};
