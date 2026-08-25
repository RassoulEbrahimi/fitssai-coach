import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './useAuth';
import { startOfDay, subDays, format } from 'date-fns';
import { de } from 'date-fns/locale';

interface AILog {
  created_at: string;
  success: boolean;
  latency_ms: number;
}

interface DailyData {
  day: string;
  count: number;
  date: Date;
}

interface AIAnalytics {
  totalSuccess: number;
  totalFail: number;
  avgLatency: number;
  dailyData: DailyData[];
}

export const useAIAnalytics = () => {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<AIAnalytics>({
    totalSuccess: 0,
    totalFail: 0,
    avgLatency: 0,
    dailyData: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const logsRef = collection(db, 'users', user.uid, 'ai_logs');
        const snap = await getDocs(query(logsRef, orderBy('createdAt', 'desc')));
        const logs = snap.docs.map(d => {
          const data = d.data();
          return {
            created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : '',
            success:    data.success    ?? false,
            latency_ms: data.latencyMs  ?? 0,
          };
        });

        if (!logs || logs.length === 0) {
          setAnalytics({
            totalSuccess: 0,
            totalFail: 0,
            avgLatency: 0,
            dailyData: []
          });
          setLoading(false);
          return;
        }

        // Calculate metrics
        const successLogs = logs.filter(l => l.success);
        const totalSuccess = successLogs.length;
        const totalFail = logs.filter(l => !l.success).length;
        const avgLatency = totalSuccess > 0
          ? Math.round(successLogs.reduce((sum, l) => sum + l.latency_ms, 0) / totalSuccess)
          : 0;

        // Calculate daily data for last 7 days
        const today = startOfDay(new Date());
        const dailyMap = new Map<string, number>();

        // Initialize all 7 days with 0
        for (let i = 6; i >= 0; i--) {
          const date = subDays(today, i);
          const key = format(date, 'yyyy-MM-dd');
          dailyMap.set(key, 0);
        }

        // Count successful requests per day
        successLogs.forEach(log => {
          const logDate = format(startOfDay(new Date(log.created_at)), 'yyyy-MM-dd');
          if (dailyMap.has(logDate)) {
            dailyMap.set(logDate, (dailyMap.get(logDate) || 0) + 1);
          }
        });

        // Convert to array for chart
        const dailyData: DailyData[] = Array.from(dailyMap.entries()).map(([dateStr, count]) => ({
          day: format(new Date(dateStr), 'EEE', { locale: de }), // Mo, Di, ...
          count,
          date: new Date(dateStr)
        }));

        setAnalytics({
          totalSuccess,
          totalFail,
          avgLatency,
          dailyData
        });
      } catch (error) {
        console.error('Error fetching AI analytics:', error);
        setAnalytics({
          totalSuccess: 0,
          totalFail: 0,
          avgLatency: 0,
          dailyData: []
        });
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [user]);

  return {
    ...analytics,
    analytics,
    loading
  };
};
