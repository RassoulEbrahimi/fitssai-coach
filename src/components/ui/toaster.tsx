import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={2500}>
      {toasts.map(function ({ id, title, description, action, icon: Icon, ...props }) {
        return (
          <Toast 
            key={id} 
            {...props}
            className="animate-in slide-in-from-top-2 fade-in-0 duration-300"
            role={props.role || "alert"}
            aria-live={props['aria-live'] || "assertive"}
          >
            <div className="flex items-start gap-3 w-full">
              {Icon && (
                <div className="flex-shrink-0 mt-0.5">
                  <Icon className="h-5 w-5" aria-hidden={true} />
                </div>
              )}
              <div className="grid gap-1 flex-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport className="top-4 sm:top-4 bottom-auto pb-safe-area-inset-bottom" />
    </ToastProvider>
  )
}
