import React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Apple, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NutritionSkeleton } from "@/components/skeletons/SectionSkeleton";
import { cn } from "@/lib/utils";
import type { NutritionDate } from "@shared/nutrition";
import type { NutritionWeek, NutritionWeekDay } from "@/lib/nutrition/v2/resolvedPlan";
import type { NutritionV2TodayView } from "@/lib/nutrition/v2/todayView";

/**
 * Nutrition V2 Today/week shell. Presentational.
 *
 * A week row shows the day, its recording status and its PLANNED kcal — nothing
 * else: no macros, no recorded values, no controls. The chevron is decoration
 * for a future day detail; it is hidden from assistive technology and nothing
 * in the week is focusable or clickable. There is no replace, generate, recipe
 * or shopping action, and no state promises a plan.
 *
 * Recording lives only in the separate `todayRecording` section the container
 * passes in for today (NUT-06); the shell itself stays read-only.
 */

interface NutritionV2TodayShellProps {
  view: NutritionV2TodayView;
  /** Today's recording section, shown above the week when today is a plan day. */
  todayRecording?: React.ReactNode;
}

/** The weekday and date of a calendar day. Formatted in UTC so the day never shifts. */
const formatDay = (date: NutritionDate, language: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

/** Presentation rounds; the model keeps the unrounded sum. */
const formatKcal = (kcal: number, language: string): string =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(Math.round(kcal));

const Message = ({
  title,
  description,
  role = "status",
  icon = "neutral",
}: {
  title: string;
  description: string;
  role?: "status" | "alert";
  icon?: "neutral" | "error";
}) => (
  <div className="text-center py-10 space-y-4" role={role}>
    <div className="flex justify-center">
      {icon === "error" ? (
        <AlertCircle className="h-12 w-12 text-destructive/60" aria-hidden="true" />
      ) : (
        <Apple className="h-12 w-12 text-muted-foreground/40" aria-hidden="true" />
      )}
    </div>
    <div className="space-y-2">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-muted-foreground max-w-md mx-auto">{description}</p>
    </div>
  </div>
);

const WeekRow = ({ day, language }: { day: NutritionWeekDay; language: string }) => {
  const { t } = useTranslation();
  const date = formatDay(day.date, language);
  const kcal = formatKcal(day.plannedKcal, language);
  const status = t(`nutritionV2.today.status.${day.recording}`);

  return (
    <li
      data-testid="nutrition-v2-week-row"
      data-date={day.date}
      data-recording={day.recording}
      aria-current={day.isToday ? "date" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-3",
        day.isToday && "bg-primary/10 ring-1 ring-primary/30"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {day.isToday ? (
            <>
              {t("nutritionV2.today.todayLabel")}
              <span className="font-normal text-muted-foreground"> · {date}</span>
            </>
          ) : (
            date
          )}
        </p>
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
      <p className="whitespace-nowrap text-sm tabular-nums text-foreground">
        {t("nutritionV2.today.plannedKcal", { kcal })}
      </p>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </li>
  );
};

const Week = ({ week, title, language }: { week: NutritionWeek; title: string; language: string }) => (
  <section aria-label={title} className="space-y-2">
    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    <ol className="space-y-1">
      {week.days.map((day) => (
        <WeekRow key={day.date} day={day} language={language} />
      ))}
    </ol>
  </section>
);

export const NutritionV2TodayShell: React.FC<NutritionV2TodayShellProps> = ({ view, todayRecording }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";

  if (view.status === "loading") {
    return (
      <div role="status" aria-busy="true" aria-label={t("nutritionV2.today.loading")}>
        <NutritionSkeleton />
      </div>
    );
  }

  const body = (() => {
    switch (view.status) {
      case "error":
        return (
          <Message
            role="alert"
            icon="error"
            title={t("nutritionV2.today.error.title")}
            description={t("nutritionV2.today.error.description")}
          />
        );
      case "ineligible":
        return (
          <Message
            title={t(`nutritionV2.today.ineligible.${view.reason}.title`)}
            description={t(`nutritionV2.today.ineligible.${view.reason}.description`)}
          />
        );
      case "notInitialized":
        return (
          <Message
            title={t("nutritionV2.today.notInitialized.title")}
            description={t("nutritionV2.today.notInitialized.description")}
          />
        );
      case "noActivePlan":
        return (
          <Message
            title={t("nutritionV2.today.noActivePlan.title")}
            description={t("nutritionV2.today.noActivePlan.description")}
          />
        );
      case "outsidePlan":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" role="status">
              {t("nutritionV2.today.outsidePlan")}
            </p>
            <Week week={view.week} title={t("nutritionV2.today.planWeekTitle")} language={language} />
          </div>
        );
      case "today":
        return (
          <div className="space-y-6">
            {todayRecording}
            <Week week={view.week} title={t("nutritionV2.today.weekTitle")} language={language} />
          </div>
        );
    }
  })();

  return (
    <Card data-testid="nutrition-v2-today" data-view={view.status}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" role="heading" aria-level={2}>
          <Apple className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("nutritionV2.today.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
};

NutritionV2TodayShell.displayName = "NutritionV2TodayShell";
