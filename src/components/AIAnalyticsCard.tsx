import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckCircle2, XCircle, Zap, Sparkles } from 'lucide-react';
import { useAIAnalytics } from '@/hooks/useAIAnalytics';
import { cn } from '@/lib/utils';

export const AIAnalyticsCard = () => {
  const { analytics, loading } = useAIAnalytics();
  const prefersReducedMotion = useReducedMotion();

  if (loading) {
    return (
      <motion.div
        initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.3, delay: prefersReducedMotion ? 0 : 0.1 }}
        className={cn(
          "relative overflow-hidden rounded-3xl p-4",
          "bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-violet-500/5",
          "dark:from-emerald-500/30 dark:via-teal-500/20 dark:to-cyan-500/10",
          "ring-1 ring-border/50",
          "shadow-xl",
          "backdrop-blur-sm",
          "animate-pulse"
        )}
      >
        <div className="h-64 bg-muted/10 rounded-lg" />
      </motion.div>
    );
  }

  const stats = [
    {
      icon: CheckCircle2,
      label: 'Erfolgreich',
      value: analytics.totalSuccess,
      color: 'text-emerald-400'
    },
    {
      icon: XCircle,
      label: 'Fehlgeschlagen',
      value: analytics.totalFail,
      color: 'text-rose-400'
    },
    {
      icon: Zap,
      label: 'Ø Latenz',
      value: analytics.avgLatency > 0 ? `${analytics.avgLatency} ms` : '—',
      color: 'text-sky-400'
    }
  ];

  const hasData = analytics.totalSuccess > 0 || analytics.totalFail > 0;

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, delay: prefersReducedMotion ? 0 : 0.1 }}
      className={cn(
        "relative overflow-hidden rounded-3xl p-4",
        "bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-violet-500/5",
        "dark:from-emerald-500/30 dark:via-teal-500/20 dark:to-cyan-500/10",
        "ring-1 ring-border/50",
        "shadow-xl",
        "backdrop-blur-sm"
      )}
    >
      {/* Decorative circles */}
      <div className={cn(
        "absolute -top-4 -right-4 w-16 h-16 rounded-full bg-indigo-500/10 dark:bg-emerald-500/20",
        !prefersReducedMotion && "animate-pulse"
      )} 
      style={{ animationDuration: '3s' }}
      />
      <div className="absolute top-1/2 -left-8 w-12 h-12 rounded-full bg-purple-500/5 dark:bg-teal-500/15" />
      <div className="absolute bottom-4 right-1/3 w-8 h-8 rounded-full bg-violet-500/15 dark:bg-cyan-500/25" />
      
      {/* Inner highlight */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-transparent via-white/5 to-white/10 dark:via-white/2 dark:to-white/5" />
      
      {/* Content */}
      <div className="relative z-10">
        {/* Centered Header */}
        <div className="text-center mb-3">
          <h3 className="text-lg font-medium text-foreground leading-relaxed flex items-center justify-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            KI-Analysen
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Sobald KI-Funktionen verfügbar sind, siehst du hier ihre Nutzung.
          </p>
        </div>

        {hasData ? (
          <>
            {/* Inline Minimal Stats */}
            <div className="flex items-center justify-around mb-4 gap-4">
              {stats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={prefersReducedMotion ? {} : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className="flex flex-col items-center"
                >
                  <stat.icon className={`w-5 h-5 mb-1 ${stat.color}`} />
                  <span className={`text-lg font-semibold ${stat.color}`}>
                    {stat.value}
                  </span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {stat.label}
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Compact Chart */}
            {analytics.dailyData.length > 0 && (
              <motion.div
                initial={prefersReducedMotion ? {} : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="space-y-2"
              >
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={analytics.dailyData}>
                    <defs>
                      <linearGradient id="aiGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
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
                        borderRadius: '12px',
                        fontSize: '11px',
                        padding: '8px'
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
                
                {/* Summary Badge */}
                <div className="text-center">
                  <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-xs text-primary font-medium">
                    ✅ {analytics.totalSuccess} AI-Session{analytics.totalSuccess !== 1 ? 's' : ''} diese Woche
                  </span>
                </div>
              </motion.div>
            )}
          </>
        ) : (
          <motion.div
            initial={prefersReducedMotion ? {} : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-8 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Noch keine KI-Aktivität
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              KI-Funktionen sind noch nicht verfügbar.
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
