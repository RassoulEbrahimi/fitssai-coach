import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import {
  parseCoachingPreferences,
  type CoachingPreferences,
} from "@/lib/coachingPreferences";
import { queryKeys } from "@/lib/queryKeys";

export interface Profile extends CoachingPreferences {
  id: string;
  email?: string;
  full_name?: string | null;
  avatar_path?: string | null;
  height?: number | null;
  weight?: number | null;
  fitness_goal?: string | null;
  activity_level?: string | null;
  experience_level?: string | null;
  age?: number | null;
  dietary_preference?: string | null;
  role?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

const docToProfile = (id: string, d: Record<string, any>): Profile => ({
  id,
  // Absent on every profile created before these questions existed. The parser
  // returns undefined rather than a default, so "never answered" stays
  // distinguishable from "answered".
  ...parseCoachingPreferences(d),
  full_name:          d.fullName           ?? null,
  fitness_goal:       d.fitnessGoal        ?? null,
  dietary_preference: d.dietaryPreference  ?? null,
  experience_level:   d.experienceLevel    ?? null,
  activity_level:     d.activityLevel      ?? null,
  weight:             d.weight             ?? null,
  height:             d.height             ?? null,
  age:                d.age                ?? null,
  avatar_path:        null,
  role:               d.role               ?? "user",
  created_at: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null,
  updated_at: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate().toISOString() : null,
});

export const useProfile = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.profile.me(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return null;
      return docToProfile(user.uid, snap.data() as Record<string, any>);
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 60,
  });
};

export const useUpdateProfile = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: Partial<Profile>) => {
      if (!user) throw new Error("Not authenticated");
      const fsData: Record<string, any> = { updatedAt: Timestamp.now() };
      if (values.full_name          !== undefined) fsData.fullName          = values.full_name;
      if (values.fitness_goal       !== undefined) fsData.fitnessGoal       = values.fitness_goal;
      if (values.dietary_preference !== undefined) fsData.dietaryPreference = values.dietary_preference;
      if (values.experience_level   !== undefined) fsData.experienceLevel   = values.experience_level;
      if (values.activity_level     !== undefined) fsData.activityLevel     = values.activity_level;
      if (values.weight             !== undefined) fsData.weight            = values.weight;
      if (values.height             !== undefined) fsData.height            = values.height;
      if (values.age                !== undefined) fsData.age               = values.age;
      if (values.equipment          !== undefined) fsData.equipment         = values.equipment;
      if (values.daysPerWeek        !== undefined) fsData.daysPerWeek       = values.daysPerWeek;
      if (values.sessionMinutes     !== undefined) fsData.sessionMinutes    = values.sessionMinutes;
      await setDoc(doc(db, "users", user.uid), fsData, { merge: true });
    },
    /*
      The cached profile is the only thing the UI reads, and it survives this
      write: it is kept fresh for an hour and persisted to localStorage, so a
      screen mounted right after a save — the dashboard, straight after
      onboarding — would otherwise render the pre-save entry (for a new user:
      null, i.e. every field a placeholder) until something else happened to
      refetch it.

      So write what was just saved into the cache before anything reads it,
      then invalidate so the next mount reconciles with the server. Seeding
      alone would leave the cache authoritative on a guess; invalidating alone
      would still render the pre-save entry while the refetch is in flight.
    */
    onSuccess: (_result, values) => {
      if (!user) return;
      const key = queryKeys.profile.me(user.id);

      queryClient.setQueryData<Profile | null>(key, (previous) => ({
        ...(previous ?? {}),
        ...values,
        id: user.uid,
      }));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
};
