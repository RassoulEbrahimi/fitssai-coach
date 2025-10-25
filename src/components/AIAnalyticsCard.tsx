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
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-glow">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-base font-bold text-foreground tracking-tight">🤖 KI-Analysen</h3>
            </div>
            <span className="text-xs text-muted-foreground">Letzte 7 Tage</span>
          </div>

          {hasData ? (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {stats.map((stat, index) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className="p-2 rounded-xl bg-card/60 backdrop-blur-sm transition-all hover:scale-[1.03] hover:shadow-[0_0_8px_hsl(var(--primary)/0.3)]"
                  >
                    <div className="flex flex-col items-center text-center">
                      <stat.icon className={`w-4 h-4 mb-1 ${stat.color}`} />
                      <span className={`text-sm font-semibold ${stat.color} tracking-tight`}>
                        {stat.value}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
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
                  transition={{ duration: 0.4, delay: 0.15 }}
                >
                  <div className="p-2 rounded-xl bg-card/40 backdrop-blur-sm">
                    <ResponsiveContainer width="100%" height={120}>
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
                          opacity={0.15}
                        />
                        <XAxis 
                          dataKey="day"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis hide />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '11px'
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          fill="url(#aiGradient)"
                          dot={{ 
                            fill: 'hsl(var(--primary))',
                            r: 3
                          }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <span className="text-[11px] text-muted-foreground block text-center mt-1">
                    ✅ {analytics.totalSuccess} AI-Sessions diese Woche
                  </span>
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
