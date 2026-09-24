import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface CatalogueExercise {
  id: string;
  name: string;
  /** The catalogue's own muscle label, when it has one. Display only. */
  targetMuscle: string | null;
}

/**
 * The shared exercise catalogue (`exercises`), the same source the existing
 * exercise selector reads. Entries without a usable name are skipped rather
 * than shown blank; duplicates by name are shown once.
 */
export function useExerciseCatalogue(enabled: boolean) {
  return useQuery({
    queryKey: ["exercise-catalogue"],
    enabled,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<CatalogueExercise[]> => {
      const snap = await getDocs(query(collection(db, "exercises"), orderBy("name")));
      const seen = new Set<string>();
      const entries: CatalogueExercise[] = [];
      for (const entry of snap.docs) {
        const data = entry.data() as { name?: unknown; target_muscle?: unknown };
        const name = typeof data.name === "string" ? data.name.trim() : "";
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const muscle = typeof data.target_muscle === "string" && data.target_muscle.trim() ? data.target_muscle.trim() : null;
        entries.push({ id: entry.id, name, targetMuscle: muscle });
      }
      return entries;
    },
  });
}
