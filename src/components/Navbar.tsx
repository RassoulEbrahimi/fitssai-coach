import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { 
  Menu, 
  X, 
  Home, 
  User, 
  LogIn, 
  UserPlus, 
  LayoutDashboard,
  LogOut,
  Shield,
  Dumbbell
} from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';

const Navbar = () => {
  const { user, signOut } = useAuth();
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (user) {
      checkAdminStatus();
    }
  }, [user]);

  const checkAdminStatus = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      setIsAdmin(data?.is_admin || false);
    } catch (error) {
      console.error('Error checking admin status:', error);
      setIsAdmin(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsOpen(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
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
          {user ? (
            <>
              <Link 
                to="/" 
                className="text-foreground hover:text-primary transition-colors"
              >
                <Home className="h-4 w-4 inline mr-2" />
                {t('navbar.home')}
              </Link>
              <Link
                to="/dashboard"
                className="text-foreground hover:text-primary transition-colors"
              >
                <LayoutDashboard className="h-4 w-4 inline mr-2" />
                {t('navbar.dashboard')}
              </Link>

              {isAdmin && (
                <Link
                  to="/admin"
                  className="text-foreground hover:text-primary transition-colors"
                >
                  <Shield className="h-4 w-4 inline mr-2" />
                  {i18n.language === 'fa' ? 'پنل مدیریت' : 'Admin Panel'}
                </Link>
              )}

              <Link
                to="/dashboard#profile"
                className="text-foreground hover:text-primary transition-colors"
              >
                <User className="h-4 w-4 inline mr-2" />
                {t('navbar.profile')}
              </Link>
            </>
          ) : (
            <>
              <Link 
                to="/" 
                className="text-foreground hover:text-primary transition-colors"
              >
                <Home className="h-4 w-4 inline mr-2" />
                {t('navbar.home')}
              </Link>
            </>
          )}
        </div>
        
        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-4">
          <LanguageSwitcher />
          {user ? (
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              {t('navbar.signOut')}
            </Button>
          ) : (
            <>
              <Link to="/auth/sign-in">
                <Button variant="outline">
                  <LogIn className="h-4 w-4 mr-2" />
                  {t('navbar.signIn')}
                </Button>
              </Link>
              <Link to="/auth/sign-up">
                <Button className="gradient-primary text-primary-foreground">
                  <UserPlus className="h-4 w-4 mr-2" />
                  {t('navbar.signUp')}
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {/* Mobile Navigation */}
      {isOpen && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4 space-y-4">
            {user ? (
              <>
                <Link
                  to="/"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  <Home className="h-4 w-4" />
                  {t('navbar.home')}
                </Link>

                <Link
                  to="/dashboard"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  {t('navbar.dashboard')}
                </Link>

                {isAdmin && (
                  <Link
                    to="/admin"
                    className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                    onClick={() => setIsOpen(false)}
                  >
                    <Shield className="h-4 w-4" />
                    {i18n.language === 'fa' ? 'پنل مدیریت' : 'Admin Panel'}
                  </Link>
                )}

                <Link
                  to="/dashboard#profile"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  <User className="h-4 w-4" />
                  {t('navbar.profile')}
                </Link>

                <div className="pt-2 border-t border-border">
                  <Button 
                    variant="outline" 
                    className="w-full justify-start"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    {t('navbar.signOut')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Link
                  to="/"
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  <Home className="h-4 w-4" />
                  {t('navbar.home')}
                </Link>

                <div className="pt-2 border-t border-border space-y-2">
                  <Link to="/auth/sign-in" onClick={() => setIsOpen(false)}>
                    <Button variant="outline" className="w-full justify-start">
                      <LogIn className="h-4 w-4 mr-2" />
                      {t('navbar.signIn')}
                    </Button>
                  </Link>
                  <Link to="/auth/sign-up" onClick={() => setIsOpen(false)}>
                    <Button className="gradient-primary text-primary-foreground w-full">
                      <UserPlus className="h-4 w-4 mr-2" />
                      {t('navbar.signUp')}
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