import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { countUnread, getNotifications } from "@/lib/notifications";
import type { TrainingNudge } from "@/lib/nudges";

interface NotificationPopoverProps {
  /** Today's training nudges, if any. Listed as-is; never counted as unread. */
  nudges?: readonly TrainingNudge[];
}

/**
 * Notification affordance.
 *
 * Two sources, both real. `getNotifications` is the (still empty) backend
 * source — there is no notification backend yet, and nothing is invented to
 * fill it. `nudges` are today's deterministic training nudges, computed from
 * the plan and the user's own logs; when one is open, the bell showing "Du
 * bist auf dem neuesten Stand" while the same nudge sits on the dashboard
 * would be its own small untruth.
 *
 * The unread badge stays tied to unread *items*: a nudge is state, not an
 * event, it is visible on the same screen, and nothing here tracks whether it
 * was read — so it is listed, never counted.
 */
export const NotificationPopover = ({ nudges = [] }: NotificationPopoverProps = {}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { actualTheme } = useTheme();
  const isDark = actualTheme === "dark";

  const notifications = getNotifications();
  const hasNotifications = notifications.length > 0 || nudges.length > 0;
  const unreadCount = countUnread(notifications);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="p-2 relative"
          aria-label={`Benachrichtigungen${unreadCount > 0 ? `, ${unreadCount} ungelesen` : ''}`}
        >
          <Bell className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-background"
            >
              {unreadCount}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>
      
      <AnimatePresence>
        {isOpen && (
          <PopoverContent
            align="end"
            sideOffset={8}
            className={cn(
              "w-80 p-0 border-0 overflow-hidden",
              "shadow-[0_0_25px_rgba(16,185,129,0.15)]"
            )}
            asChild
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ 
                type: "spring", 
                stiffness: 300, 
                damping: 25,
                duration: 0.3 
              }}
              className={cn(
                "rounded-2xl backdrop-blur-xl border",
                isDark
                  ? "bg-emerald-900/60 border-emerald-500/30"
                  : "bg-white/40 border-emerald-500/30"
              )}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-emerald-500/20">
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <span className="text-emerald-500" aria-hidden="true">●</span>
                  Benachrichtigungen
                </h3>
              </div>

              {/* Notifications List */}
              <div className="max-h-[320px] overflow-y-auto">
                {hasNotifications ? (
                  <ul className="py-2" role="list">
                    {nudges.map((nudge, index) => (
                      <motion.li
                        key={nudge.key}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="px-4 py-3 border-l-2 border-l-emerald-500"
                      >
                        <p className="text-sm font-medium text-foreground leading-tight">
                          {nudge.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{nudge.body}</p>
                      </motion.li>
                    ))}
                    {notifications.map((notification, index) => (
                      <motion.li
                        key={notification.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={cn(
                          "px-4 py-3 border-l-2",
                          notification.read 
                            ? "border-l-transparent opacity-60" 
                            : "border-l-emerald-500"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground leading-tight">
                            {notification.title}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                          <span className="text-xs text-muted-foreground">
                            {notification.timeAgo}
                          </span>
                        </div>
                      </motion.li>
                    ))}
                  </ul>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="py-12 px-4 text-center"
                  >
                    <div className="text-4xl mb-2" aria-hidden="true">🎉</div>
                    <p className="text-sm text-muted-foreground">
                      Du bist auf dem neuesten Stand.
                    </p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  );
};
