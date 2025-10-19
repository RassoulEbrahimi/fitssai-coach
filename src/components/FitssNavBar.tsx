import { NavBar } from "@/components/ui/tubelight-navbar"
import { Home, Dumbbell, Utensils, User } from "lucide-react"
import { forwardRef } from "react"

type Tab = 'workout' | 'nutrition' | 'profile' | 'dashboard'

interface FitssNavBarProps {
  activeTab: 'dashboard' | 'workout' | 'nutrition' | 'profile'
  onChange: (tab: Tab) => void
}

export const FitssNavBar = forwardRef<HTMLDivElement, FitssNavBarProps>(
  ({ activeTab, onChange }, ref) => {
    const navItems = [
      { name: "Dashboard", id: "dashboard", icon: Home },
      { name: "Trainingsplan", id: "workout", icon: Dumbbell },
      { name: "Ernährungsplan", id: "nutrition", icon: Utensils },
      { name: "Profil", id: "profile", icon: User },
    ]

    return (
      <NavBar 
        ref={ref}
        items={navItems} 
        activeTab={activeTab}
        onTabChange={(id) => onChange(id as Tab)}
      />
    )
  }
)

FitssNavBar.displayName = "FitssNavBar"
