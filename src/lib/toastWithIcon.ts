import { toast as baseToast } from '@/hooks/use-toast';
import { CheckCircle2, WifiOff, AlertTriangle, XCircle, Info } from 'lucide-react';
import { logEvent } from './telemetryClient';

type ToastVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

interface ToastWithIconOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  role?: 'status' | 'alert';
  'aria-live'?: 'polite' | 'assertive';
}

/**
 * Enhanced toast notification with context-specific icons
 * Automatically adds appropriate icon based on variant
 */
export const toastWithIcon = ({
  title,
  description,
  variant = 'default',
  duration = 2500,
  role = 'status',
  'aria-live': ariaLive = 'polite',
  ...rest
}: ToastWithIconOptions) => {
  // Map variant to icon
  const iconMap = {
    success: CheckCircle2,
    warning: AlertTriangle,
    destructive: XCircle,
    info: Info,
    default: Info,
  };

  const Icon = iconMap[variant as keyof typeof iconMap];

  // Log telemetry
  logEvent('toast_icon_displayed', { variant, title });

  // Convert variant to toast variant (success -> default for styling)
  const toastVariant = variant === 'destructive' ? 'destructive' : 'default';

  return baseToast({
    title,
    description,
    variant: toastVariant,
    duration,
    role,
    'aria-live': ariaLive,
    icon: Icon,
    ...rest,
  } as any);
};

// Convenience methods
export const toastSuccess = (title: string, description?: string, duration = 2500) =>
  toastWithIcon({ title, description, variant: 'success', duration, role: 'status', 'aria-live': 'polite' });

export const toastError = (title: string, description?: string, duration = 3000) =>
  toastWithIcon({ title, description, variant: 'destructive', duration, role: 'alert', 'aria-live': 'assertive' });

export const toastWarning = (title: string, description?: string, duration = 3000) =>
  toastWithIcon({ title, description, variant: 'warning', duration, role: 'alert', 'aria-live': 'assertive' });

export const toastInfo = (title: string, description?: string, duration = 2500) =>
  toastWithIcon({ title, description, variant: 'info', duration, role: 'status', 'aria-live': 'polite' });

export const toastOffline = (title: string, description?: string, duration = 3000) =>
  toastWithIcon({ 
    title, 
    description, 
    variant: 'warning', 
    duration, 
    role: 'alert', 
    'aria-live': 'assertive',
    icon: WifiOff 
  } as any);
