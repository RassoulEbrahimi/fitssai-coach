import React, { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  readNotificationChannelState,
  requestNotificationPermission,
  type NotificationChannelState,
} from "@/lib/nudges";

/**
 * Control over browser notifications — and an honest account of what they are.
 *
 * Three rules this card exists to keep:
 *
 *   1. Permission is only ever requested from the button below. Nothing asks
 *      on load, on navigation or on render.
 *   2. The state shown is the browser's own answer, re-read on every mount and
 *      whenever the tab is looked at again. There is no app-level "enabled"
 *      flag that could stay on after the user revoked permission.
 *   3. It says plainly that notifications appear while the app is open. This
 *      app has no push backend — no FCM, no VAPID subscription, no scheduled
 *      Function — so a message that arrives while the app is closed is not
 *      something it can deliver, and not something it will claim.
 */

interface StatePresentation {
  icon: React.ElementType;
  label: string;
  description: string;
  tone: string;
}

const PRESENTATION: Record<NotificationChannelState, StatePresentation> = {
  unsupported: {
    icon: BellOff,
    label: "Nicht verfügbar",
    description:
      "Dieser Browser unterstützt keine Systembenachrichtigungen. Die Hinweise in der App funktionieren weiterhin.",
    tone: "bg-muted text-muted-foreground",
  },
  default: {
    icon: Bell,
    label: "Nicht aktiviert",
    description:
      "Du kannst Systembenachrichtigungen erlauben. Ohne Freigabe siehst du die Hinweise weiterhin in der App.",
    tone: "bg-muted text-muted-foreground",
  },
  granted: {
    icon: BellRing,
    label: "Erlaubt",
    description:
      "Offene Einheiten können als Systembenachrichtigung erscheinen — höchstens einmal pro Trainingstag.",
    tone: "bg-emerald-500/20 text-emerald-500",
  },
  denied: {
    icon: BellOff,
    label: "Blockiert",
    description:
      "Benachrichtigungen sind für diese Seite blockiert. Das lässt sich nur in den Browsereinstellungen ändern. Die Hinweise in der App bleiben unverändert.",
    tone: "bg-muted text-muted-foreground",
  },
};

export const NotificationSettingsCard: React.FC<{ className?: string }> = ({ className }) => {
  const [state, setState] = useState<NotificationChannelState>(readNotificationChannelState);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible") setState(readNotificationChannelState());
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /* The one and only permission prompt in the app, behind an explicit click. */
  const onEnable = useCallback(async () => {
    setIsRequesting(true);
    try {
      setState(await requestNotificationPermission());
    } finally {
      setIsRequesting(false);
    }
  }, []);

  const presentation = PRESENTATION[state];
  const Icon = presentation.icon;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("p-2 rounded-lg shrink-0", presentation.tone)}>
            <Icon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Benachrichtigungen</span>
            <p className="text-xs text-muted-foreground mt-0.5">{presentation.label}</p>
          </div>
        </div>

        {/* Only offered where asking can still lead anywhere. */}
        {state === "default" && (
          <Button size="sm" variant="secondary" onClick={onEnable} disabled={isRequesting}>
            {isRequesting ? "Wird angefragt…" : "Erlauben"}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{presentation.description}</p>

      <div className="flex items-start gap-2 rounded-xl bg-muted/40 p-3">
        <Info className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Hinweise werden geprüft, während die App geöffnet ist. Es gibt keine Benachrichtigungen
          bei geschlossener App und keine feste Uhrzeit.
        </p>
      </div>
    </div>
  );
};

export default NotificationSettingsCard;
