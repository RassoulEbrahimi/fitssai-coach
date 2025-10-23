import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export const useAISessions = () => {
  const { user } = useAuth();
  const [aiSessionsCount, setAiSessionsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAISessions = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const { count, error } = await supabase
          .from('ai_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('success', true);

        if (error) throw error;
        setAiSessionsCount(count || 0);
      } catch (error) {
        console.error('Error fetching AI sessions:', error);
        setAiSessionsCount(0);
      } finally {
        setLoading(false);
      }
    };

    fetchAISessions();
  }, [user]);

  return { aiSessionsCount, loading };
};
