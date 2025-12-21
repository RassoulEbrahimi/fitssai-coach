import { NavBar } from "@/components/ui/tubelight-navbar"
import { Home, Dumbbell, Utensils, User } from "lucide-react"
import { forwardRef } from "react"

import { AppView, NAVIGATION_CONFIG, NAVIGATION_Order } from "@/lib/navigation"

interface FitssNavBarProps {
  activeView: AppView
  onChange: (view: AppView) => void
  enableAdvancedGlass?: boolean
}

export const FitssNavBar = forwardRef<HTMLDivElement, FitssNavBarProps>(
  ({ activeView, onChange, enableAdvancedGlass = false }, ref) => {
    const navItems = NAVIGATION_Order.map(view => ({
      name: NAVIGATION_CONFIG[view].label,
      id: view,
      icon: NAVIGATION_CONFIG[view].icon
    }))

    return (
      <NavBar
        ref={ref}
        items={navItems}
        activeTab={activeView}
        onTabChange={(id) => onChange(id as AppView)}
        enableAdvancedGlass={enableAdvancedGlass}
      />
    )
  }
)

FitssNavBar.displayName = "FitssNavBar"
