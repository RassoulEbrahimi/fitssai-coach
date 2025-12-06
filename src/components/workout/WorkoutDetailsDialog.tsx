import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Flame } from "lucide-react";
import { useTranslation } from "react-i18next";
import { estimateCalories } from "@/lib/calorieEstimation";

interface WorkoutDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseName: string;
  onConfirm: (duration: number, calories: number) => void;
  isLoading?: boolean;
  initialDuration?: number;
  initialCalories?: number;
}

const DEFAULT_DURATION = 10;
const DEFAULT_CALORIES = 50;

const WorkoutDetailsDialog: React.FC<WorkoutDetailsDialogProps> = ({
  open,
  onOpenChange,
  exerciseName,
  onConfirm,
  isLoading = false,
  initialDuration = DEFAULT_DURATION,
  initialCalories = DEFAULT_CALORIES,
}) => {
  const { t } = useTranslation();
  const [duration, setDuration] = useState<string>(String(initialDuration));
  const [calories, setCalories] = useState<string>(String(initialCalories));

  // Reset values when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      setDuration(String(initialDuration));
      setCalories(String(initialCalories));
    }
  }, [open, initialDuration, initialCalories]);

  const handleConfirm = () => {
    const durationNum = parseInt(duration) || DEFAULT_DURATION;
    const caloriesNum = parseInt(calories) || DEFAULT_CALORIES;
    onConfirm(durationNum, caloriesNum);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {t('workout.detailsTitle', 'Workout Details')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {exerciseName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Duration Input */}
          <div className="grid gap-2">
            <Label htmlFor="duration" className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              {t('workout.duration', 'Dauer (Minuten)')}
            </Label>
            <Input
              id="duration"
              type="number"
              min={1}
              max={480}
              value={duration}
              onChange={(e) => {
                const newDuration = e.target.value;
                setDuration(newDuration);
                // Auto-recalculate calories based on new duration
                const durationNum = parseInt(newDuration) || DEFAULT_DURATION;
                const newCalories = estimateCalories(exerciseName, durationNum);
                setCalories(String(newCalories));
              }}
              placeholder={String(DEFAULT_DURATION)}
              className="text-center text-lg font-medium"
              autoFocus
            />
          </div>

          {/* Calories Input */}
          <div className="grid gap-2">
            <Label htmlFor="calories" className="flex items-center gap-2 text-sm">
              <Flame className="h-4 w-4 text-orange-500" />
              {t('workout.calories', 'Kalorien verbrannt')}
            </Label>
            <Input
              id="calories"
              type="number"
              min={0}
              max={5000}
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
              placeholder={String(DEFAULT_CALORIES)}
              className="text-center text-lg font-medium"
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
          >
            {t('common.cancel', 'Abbrechen')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            className="min-w-[100px]"
          >
            {isLoading ? (
              <span className="animate-pulse">{t('common.saving', 'Speichern...')}</span>
            ) : (
              t('workout.complete', 'Abschließen')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WorkoutDetailsDialog;
