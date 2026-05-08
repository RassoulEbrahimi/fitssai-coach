import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "./useAuth";

interface WorkoutContext {
  streak: number; lastWorkoutType: "HighIntensity" | "Moderate" | "Light" | null;
  recentFocus: string[]; recoveryDays: number;
}

export function useWorkoutContext() {
  const { user } = useAuth();

  const { data: context } = useQuery({
    queryKey: ["workout-context", user?.id],
    queryFn: async (): Promise<WorkoutContext> => {
      if (!user) return { streak: 0, lastWorkoutType: null, recentFocus: [], recoveryDays: 0 };

      const plansRef = collection(db, "users", user.uid, "workout_plans");
      const snap = await getDocs(query(plansRef, orderBy("createdAt", "desc"), limit(1)));
      if (snap.empty || !snap.docs[0].data().content)
        return { streak: 0, lastWorkoutType: null, recentFocus: [], recoveryDays: 0 };

      const content = snap.docs[0].data().content as any;
      const weeks = Object.keys(content).filter(k => k.startsWith("Week"));
      const recentFocus: string[] = [];
      let lastWorkoutType: WorkoutContext["lastWorkoutType"] = null;
      let recoveryDays = 0;
      let streak = 0;
      let foundLastWorkout = false;

      for (const week of weeks.reverse()) {
        const weekData = content[week];
        if (!Array.isArray(weekData)) continue;
        for (let di = weekData.length - 1; di >= 0; di--) {
          const day = weekData[di];
          if (!day?.exercises?.length) { recoveryDays++; continue; }
          if (!foundLastWorkout) {
            foundLastWorkout = true;
            const exs = day.exercises || [];
            const totalDur = exs.reduce((s: number, e: any) => s + (e.duration || 0), 0);
            const hiit = exs.some((e: any) => ["burpee","sprint","hiit"].some(k => e.name?.toLowerCase().includes(k)));
            lastWorkoutType = hiit || totalDur > 60 ? "HighIntensity" : totalDur > 30 ? "Moderate" : "Light";
            exs.forEach((e: any) => {
              const n = e.name?.toLowerCase() || "";
              if (n.includes("push") || n.includes("chest")) recentFocus.push("Push");
              if (n.includes("pull") || n.includes("back"))  recentFocus.push("Pull");
              if (n.includes("leg")  || n.includes("squat")) recentFocus.push("Legs");
              if (n.includes("core") || n.includes("plank")) recentFocus.push("Core");
            });
          }
          streak += day.exercises?.length > 0 ? 1 : 0;
        }
      }

      return {
        streak: Math.min(streak, 7), lastWorkoutType,
        recentFocus: [...new Set(recentFocus)].slice(0, 3),
        recoveryDays: foundLastWorkout ? recoveryDays : 0,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  return context || { streak: 0, lastWorkoutType: null, recentFocus: [], recoveryDays: 0 };
}
