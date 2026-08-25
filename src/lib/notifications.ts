/**
 * Notification source.
 *
 * There is no notification backend yet, so there is nothing truthful to show:
 * this returns an empty list rather than sample data. The shape and the
 * accessors exist so the UI can be written against a real source now and keep
 * working unchanged once one is wired up — at which point only
 * `getNotifications` needs to change.
 */

export interface AppNotification {
  id: string;
  title: string;
  /** Human-readable relative time, e.g. "vor 2 Std." */
  timeAgo: string;
  read: boolean;
}

/** No notification source exists yet, so there is nothing to report. */
export const getNotifications = (): AppNotification[] => [];

export const countUnread = (notifications: readonly AppNotification[]): number =>
  notifications.filter((notification) => !notification.read).length;

/** The badge is a claim about real unread items; no items means no badge. */
export const hasUnread = (notifications: readonly AppNotification[]): boolean =>
  countUnread(notifications) > 0;
