import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';

import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  X,
  Home,
  User2,
  LogIn,
  UserPlus,
  LayoutDashboard,
  LogOut,
  Shield,
  Dumbbell,
  Utensils
} from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';
import ThemeToggle from './ThemeToggle';
import InstallPrompt from './InstallPrompt';

interface NavbarProps {
  variant?: 'default' | 'landing';
}

const Navbar = ({ variant = 'default' }: NavbarProps) => {
  const { user, signOut } = useAuth();
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Map the current hash to one of: 'dashboard' | 'workout' | 'nutrition' | 'profile'
  function hashToTab(hash: string): 'dashboard' | 'workout' | 'nutrition' | 'profile' {
    const clean = (hash || '').replace(/^#\/?/, '').toLowerCase();
    if (clean === '' || clean === 'dashboard' || clean === '/') return 'dashboard';
    if (clean === 'workout') return 'workout';
    if (clean === 'nutrition') return 'nutrition';
    if (clean === 'profile') return 'profile';
    return 'dashboard';
  }

  const DESKTOP_TABS: Array<{
    id: 'dashboard' | 'workout' | 'nutrition' | 'profile';
    label: string;
    href: string;
    Icon: React.ComponentType<any>;
  }> = [
      { id: 'dashboard', label: 'Dashboard', href: '/dashboard#/', Icon: Home },
      { id: 'workout', label: 'Trainingsplan', href: '/dashboard#/workout', Icon: Dumbbell },
      { id: 'nutrition', label: 'Ernährungsplan', href: '/dashboard#/nutrition', Icon: Utensils },
      { id: 'profile', label: 'Profil', href: '/dashboard#/profile', Icon: User2 },
    ];

  const [activeDesktopTab, setActiveDesktopTab] = useState<'dashboard' | 'workout' | 'nutrition' | 'profile'>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    return hashToTab(window.location.hash);
  });

  useEffect(() => {
    if (user) {
      checkAdminStatus();
    }
  }, [user]);

  useEffect(() => {
    const onHashChange = () => setActiveDesktopTab(hashToTab(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const checkAdminStatus = async () => {
    if (!user) return;
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('@/lib/firebase');
      const snap = await getDoc(doc(db, 'users', user.uid));
      setIsAdmin(snap.exists() && snap.data()?.role === 'admin');
    } catch {
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

  const navClasses = variant === 'landing'
    ? "fixed top-0 w-full z-50 bg-black/10 backdrop-blur-md border-b border-white/5 hidden md:flex transition-colors duration-300"
    : "fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border hidden md:flex";

  return (
    <motion.nav
      className={navClasses}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Link to="/" className="flex items-center gap-2">
            <motion.div
              className="gradient-primary p-2 rounded-lg"
              whileHover={{ rotate: 360 }}
              transition={{ duration: 0.5 }}
            >
              <Dumbbell className="h-6 w-6 text-primary-foreground" />
            </motion.div>
            <span className="text-xl font-bold">FitssAI</span>
          </Link>
        </motion.div>

        {/* Desktop Navigation */}
        {user && (
          <nav
            className="hidden md:flex items-center gap-2"
            role="navigation"
            aria-label="Hauptnavigation"
          >
            {DESKTOP_TABS.map(({ id, label, href, Icon }) => {
              const isActive = activeDesktopTab === id;
              return (
                <a
                  key={id}
                  href={href}
                  className={[
                    "inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground"
                  ].join(' ')}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={label}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  <span className="whitespace-nowrap">{label}</span>
                </a>
              );
            })}
          </nav>
        )}

        {!user && (
          <div className="hidden md:flex items-center gap-8">
            <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
              <Link
                to="/"
                className="text-foreground hover:text-primary transition-colors relative story-link"
              >
                <Home className="h-4 w-4 inline mr-2" />
                {t('navbar.home')}
              </Link>
            </motion.div>
          </div>
        )}

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-4">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <InstallPrompt />
          </motion.div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <ThemeToggle />
          </motion.div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <LanguageSwitcher />
          </motion.div>
          {user ? (
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button variant="outline" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                {t('navbar.signOut')}
              </Button>
            </motion.div>
          ) : (
            <>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to="/auth/sign-in">
                  <Button variant="outline">
                    <LogIn className="h-4 w-4 mr-2" />
                    {t('navbar.signIn')}
                  </Button>
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to="/auth/sign-up">
                  <Button className="gradient-primary text-primary-foreground">
                    <UserPlus className="h-4 w-4 mr-2" />
                    {t('navbar.signUp')}
                  </Button>
                </Link>
              </motion.div>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsOpen(!isOpen)}
          >
            <AnimatePresence mode="wait">
              {isOpen ? (
                <motion.div
                  key="close"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <X className="h-6 w-6" />
                </motion.div>
              ) : (
                <motion.div
                  key="menu"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Menu className="h-6 w-6" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </motion.div>
      </div>

      {/* Mobile Navigation */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="md:hidden border-t border-border bg-background/95 backdrop-blur-sm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
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

                  <Link
                    to="/dashboard#profile"
                    className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
                    onClick={() => setIsOpen(false)}
                  >
                    <User2 className="h-4 w-4" />
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
              <div className="pt-2 border-t border-border flex items-center gap-2">
                <InstallPrompt />
                <ThemeToggle />
                <LanguageSwitcher />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};

export default Navbar;