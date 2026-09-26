import React, { useState } from "react";
import { useCurrentNutritionV2Target } from "@/hooks/queries/useNutritionV2";
import { useNutritionV2TargetFreshness, useNutritionV2TargetMutation } from "@/hooks/queries/useNutritionV2Target";
import { useProfile, useUpdateProfile } from "@/hooks/queries/useProfile";
import { NutritionV2TargetCard } from "./NutritionV2TargetCard";
import { NutritionV2TargetSetupSheet } from "./NutritionV2TargetSetup";

/**
 * The Nutrition V2 TARGET section of Today (NUT-08): the current target read
 * through the state pointer (NUT-05's `useCurrentNutritionV2Target` — no other
 * target read), its freshness against the profile, and the target setup.
 *
 * Rendering reads; it never calls the target callable and never creates a
 * state or a target. Only a confirmed setup does. V2-only: unreachable while
 * `NUTRITION_V2_ENABLED` is false.
 */
export const NutritionV2TargetSection: React.FC = () => {
  const target = useCurrentNutritionV2Target();
  const current = target.status === "success" ? target.data : null;
  const freshness = useNutritionV2TargetFreshness(current);
  const mutation = useNutritionV2TargetMutation();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const [open, setOpen] = useState(false);

  const canSetUp = mutation.availability.status === "available";

  return (
    <>
      <NutritionV2TargetCard target={target} freshness={freshness} onSetUp={canSetUp ? () => setOpen(true) : undefined} />
      <NutritionV2TargetSetupSheet
        open={open}
        onClose={() => setOpen(false)}
        profile={profile.data}
        mutation={mutation}
        saveProfile={updateProfile.mutateAsync}
      />
    </>
  );
};

NutritionV2TargetSection.displayName = "NutritionV2TargetSection";
