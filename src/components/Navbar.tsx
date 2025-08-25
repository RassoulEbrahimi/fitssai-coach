import { Button } from "@/components/ui/button";
import { Dumbbell, Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import LanguageSwitcher from "./LanguageSwitcher";

const Navbar = () => {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <div className="gradient-primary p-2 rounded-lg">
            <Dumbbell className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">FitssAI</span>
        </Link>
        
        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-smooth">
            {t('navigation.home')}
          </Link>
          {user ? (
            <>
              <Link to="/dashboard" className="text-muted-foreground hover:text-foreground transition-smooth">
                {t('navigation.dashboard')}
              </Link>
              <Link to="/dashboard#profile" className="text-muted-foreground hover:text-foreground transition-smooth">
                {t('navigation.profile')}
              </Link>
            </>
          ) : (
            <>
              <Link to="#features" className="text-muted-foreground hover:text-foreground transition-smooth">
                {t('navigation.features')}
              </Link>
              <Link to="#pricing" className="text-muted-foreground hover:text-foreground transition-smooth">
                {t('navigation.pricing')}
              </Link>
            </>
          )}
        </div>
        
        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-4">
          <LanguageSwitcher />
          {user ? (
            <Button variant="ghost" onClick={handleSignOut}>
              {t('navigation.signOut')}
            </Button>
          ) : (
            <>
              <Link to="/auth/sign-in">
                <Button variant="ghost">{t('navigation.signIn')}</Button>
              </Link>
              <Link to="/auth/sign-up">
                <Button variant="hero">{t('navigation.signUp')}</Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4 space-y-4">
            <Link 
              to="/" 
              className="block text-muted-foreground hover:text-foreground transition-smooth"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t('navigation.home')}
            </Link>
            {user ? (
              <>
                <Link 
                  to="/dashboard" 
                  className="block text-muted-foreground hover:text-foreground transition-smooth"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('navigation.dashboard')}
                </Link>
                <Link 
                  to="/dashboard#profile" 
                  className="block text-muted-foreground hover:text-foreground transition-smooth"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('navigation.profile')}
                </Link>
                <div className="pt-2 border-t border-border">
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start"
                    onClick={() => {
                      handleSignOut();
                      setMobileMenuOpen(false);
                    }}
                  >
                    {t('navigation.signOut')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Link 
                  to="#features" 
                  className="block text-muted-foreground hover:text-foreground transition-smooth"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('navigation.features')}
                </Link>
                <Link 
                  to="#pricing" 
                  className="block text-muted-foreground hover:text-foreground transition-smooth"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('navigation.pricing')}
                </Link>
                <div className="pt-2 border-t border-border space-y-2">
                  <Link to="/auth/sign-in" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" className="w-full justify-start">
                      {t('navigation.signIn')}
                    </Button>
                  </Link>
                  <Link to="/auth/sign-up" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="hero" className="w-full">
                      {t('navigation.signUp')}
                    </Button>
                  </Link>
                </div>
              </>
            )}
            <div className="pt-2 border-t border-border">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;