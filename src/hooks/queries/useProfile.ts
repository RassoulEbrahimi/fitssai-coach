import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Profile {
    id: string;
    email?: string;
    full_name?: string;
    avatar_path?: string;
    height?: number;
    weight?: number;
    fitness_goal?: string;
    activity_level?: string;
    age?: number;
    dietary_preference?: string;
    created_at?: string;
    updated_at?: string;
}

export const useProfile = () => {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['profile', user?.id],
        queryFn: async () => {
            if (!user) return null;

            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) throw error;
            return data;
        },
        enabled: !!user,
        staleTime: 1000 * 60 * 60, // 1 hour
    });
};
