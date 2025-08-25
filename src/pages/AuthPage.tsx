import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import Navbar from "@/components/Navbar";

const AuthPage = () => {
  const { t } = useTranslation();
  const { mode } = useParams<{ mode: 'sign-in' | 'sign-up' }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isSignUp = mode === 'sign-up';

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });
      
      if (error) throw error;
      
      toast.success("Check your email for verification link!");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16 min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md gradient-card border-primary/20 shadow-card">
          <CardHeader className="text-center">
            <div className="flex items-center justify-between mb-4">
              <Link to="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {t('auth.backToHome')}
                </Button>
              </Link>
            </div>
            <CardTitle className="text-3xl font-bold mb-2">
              {isSignUp ? t('auth.signUp') : t('auth.signIn')}
            </CardTitle>
            <p className="text-muted-foreground">
              {isSignUp ? t('auth.signUpSubtitle') : t('auth.signInSubtitle')}
            </p>
          </CardHeader>
          
          <CardContent>
            <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
              <div>
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              
              <div>
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full gradient-primary text-primary-foreground shadow-glow"
                disabled={loading}
              >
                {loading 
                  ? (isSignUp ? t('auth.signingUp') : t('auth.signingIn'))
                  : (isSignUp ? t('auth.signUp') : t('auth.signIn'))
                }
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {isSignUp ? t('auth.alreadyHaveAccount') : t('auth.dontHaveAccount')}{' '}
                <Link 
                  to={isSignUp ? '/auth/sign-in' : '/auth/sign-up'} 
                  className="text-primary hover:underline"
                >
                  {isSignUp ? t('auth.signIn') : t('auth.signUp')}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AuthPage;