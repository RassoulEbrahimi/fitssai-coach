import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Users, 
  Shield, 
  ShieldCheck, 
  Trash2,
  Eye,
  UserCheck,
  UserX,
  RefreshCw,
  Dumbbell,
  Apple,
  FileText
} from "lucide-react";

interface UserProfile {
  id: string;
  age: number;
  weight: number;
  height: number;
  fitness_goal: string;
  dietary_preference: string;
  is_admin: boolean;
  created_at: string;
  email?: string;
}

interface Plan {
  id: string;
  user_id: string;
  content: any;
  created_at: string;
  type: 'workout' | 'nutrition';
  user_email?: string;
}

const AdminPanel = () => {
  const { user, loading } = useAuth();
  const { t, i18n } = useTranslation();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [regeneratingPlan, setRegeneratingPlan] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      checkAdminStatus();
      fetchAllUsers();
      fetchAllPlans();
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
    } finally {
      setCheckingAdmin(false);
    }
  };

  const fetchAllUsers = async () => {
    try {
      // Get all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get all users from auth to get emails
      const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
      
      if (authError) throw authError;

      // Merge profile data with email from auth
      const usersWithEmails = profiles?.map(profile => {
        const authUser = authUsers?.users?.find((au: any) => au.id === profile.id);
        return {
          ...profile,
          email: authUser?.email || 'N/A'
        };
      }) || [];

      setUsers(usersWithEmails);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const toggleAdminStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_admin: !currentStatus })
        .eq('id', userId);

      if (error) throw error;

      setUsers(users.map(user => 
        user.id === userId 
          ? { ...user, is_admin: !currentStatus }
          : user
      ));

      toast.success(`Admin status ${!currentStatus ? 'granted' : 'revoked'} successfully`);
    } catch (error) {
      console.error('Error updating admin status:', error);
      toast.error('Failed to update admin status');
    }
  };

  const fetchAllPlans = async () => {
    try {
      // Fetch workout plans
      const { data: workoutPlans, error: workoutError } = await supabase
        .from('workout_plans')
        .select('id, user_id, content, created_at')
        .order('created_at', { ascending: false });

      if (workoutError) throw workoutError;

      // Fetch nutrition plans
      const { data: nutritionPlans, error: nutritionError } = await supabase
        .from('nutrition_plans')
        .select('id, user_id, content, created_at')
        .order('created_at', { ascending: false });

      if (nutritionError) throw nutritionError;

      // Get all users from auth to get emails
      const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
      
      if (authError) throw authError;

      // Combine and format plans
      const allPlans: Plan[] = [
        ...(workoutPlans || []).map(plan => ({
          ...plan,
          type: 'workout' as const,
          user_email: authUsers?.users?.find((u: any) => u.id === plan.user_id)?.email || 'N/A'
        })),
        ...(nutritionPlans || []).map(plan => ({
          ...plan,
          type: 'nutrition' as const,
          user_email: authUsers?.users?.find((u: any) => u.id === plan.user_id)?.email || 'N/A'
        }))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setPlans(allPlans);
    } catch (error) {
      console.error('Error fetching plans:', error);
      toast.error('Failed to load plans');
    } finally {
      setLoadingPlans(false);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      // Delete from auth.users (profiles will cascade delete)
      const { error } = await supabase.auth.admin.deleteUser(userId);

      if (error) throw error;

      setUsers(users.filter(user => user.id !== userId));
      toast.success('User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  const regeneratePlan = async (planUserId: string, planType: 'workout' | 'nutrition') => {
    setRegeneratingPlan(`${planUserId}-${planType}`);
    try {
      const { data, error } = await supabase.functions.invoke('generate-plans', {
        body: { 
          user_id: planUserId,
          language: i18n.language, // Use admin's current language preference
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success('Plan regenerated successfully!');
        await fetchAllPlans(); // Refresh the plans
      } else {
        throw new Error(data.error || 'Failed to regenerate plan');
      }
    } catch (error) {
      console.error('Error regenerating plan:', error);
      toast.error('Failed to regenerate plan');
    } finally {
      setRegeneratingPlan(null);
    }
  };

  const deletePlan = async (planId: string, planType: 'workout' | 'nutrition') => {
    try {
      const table = planType === 'workout' ? 'workout_plans' : 'nutrition_plans';
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', planId);

      if (error) throw error;

      setPlans(plans.filter(plan => plan.id !== planId));
      toast.success('Plan deleted successfully');
    } catch (error) {
      console.error('Error deleting plan:', error);
      toast.error('Failed to delete plan');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(i18n.language === 'fa' ? 'fa-IR' : 'en-US');
  };

  const formatGoal = (goal: string) => {
    const goalMap: Record<string, string> = {
      'gain-muscle': i18n.language === 'fa' ? 'افزایش عضله' : 'Gain Muscle',
      'lose-fat': i18n.language === 'fa' ? 'کاهش چربی' : 'Lose Fat',
      'improve-cardio': i18n.language === 'fa' ? 'بهبود قلبی' : 'Improve Cardio',
      'maintain': i18n.language === 'fa' ? 'حفظ وضعیت' : 'Maintain'
    };
    return goalMap[goal] || goal;
  };

  const formatDiet = (diet: string) => {
    const dietMap: Record<string, string> = {
      'no-preference': i18n.language === 'fa' ? 'بدون ترجیح' : 'No Preference',
      'vegetarian': i18n.language === 'fa' ? 'گیاهی' : 'Vegetarian',
      'vegan': i18n.language === 'fa' ? 'وگان' : 'Vegan',
      'keto': i18n.language === 'fa' ? 'کتو' : 'Keto',
      'high-protein': i18n.language === 'fa' ? 'پروتین بالا' : 'High Protein'
    };
    return dietMap[diet] || diet;
  };

  if (loading || checkingAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-16 flex items-center justify-center min-h-screen">
          <div className="text-xl">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  if (isAdmin === false) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        <div className="max-w-7xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">
                {i18n.language === 'fa' ? 'پنل مدیریت' : 'Admin Panel'}
              </h1>
            </div>
            <p className="text-muted-foreground">
              {i18n.language === 'fa' 
                ? 'مدیریت کاربران و دسترسی‌های سیستم' 
                : 'Manage users and system access'}
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="gradient-card border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {i18n.language === 'fa' ? 'کل کاربران' : 'Total Users'}
                    </p>
                    <p className="text-2xl font-bold text-primary">{users.length}</p>
                  </div>
                  <Users className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="gradient-card border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {i18n.language === 'fa' ? 'مدیران' : 'Admins'}
                    </p>
                    <p className="text-2xl font-bold text-primary">
                      {users.filter(u => u.is_admin).length}
                    </p>
                  </div>
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="gradient-card border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {i18n.language === 'fa' ? 'کاربران عادی' : 'Regular Users'}
                    </p>
                    <p className="text-2xl font-bold text-primary">
                      {users.filter(u => !u.is_admin).length}
                    </p>
                  </div>
                  <UserCheck className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>

            <Card className="gradient-card border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {i18n.language === 'fa' ? 'کل برنامه‌ها' : 'Total Plans'}
                    </p>
                    <p className="text-2xl font-bold text-primary">{plans.length}</p>
                  </div>
                  <FileText className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="users" className="space-y-6">
            <TabsList className="grid w-full md:w-fit grid-cols-2 md:grid-cols-2 bg-card border border-border">
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {i18n.language === 'fa' ? 'کاربران' : 'Users'}
              </TabsTrigger>
              <TabsTrigger value="plans" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {i18n.language === 'fa' ? 'برنامه‌ها' : 'Plans'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="space-y-6">
              <Card className="gradient-card border-primary/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    {i18n.language === 'fa' ? 'مدیریت کاربران' : 'User Management'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
              {loadingUsers ? (
                <div className="text-center py-8">
                  <div className="text-lg">Loading users...</div>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{i18n.language === 'fa' ? 'ایمیل' : 'Email'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'سن' : 'Age'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'وزن' : 'Weight'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'قد' : 'Height'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'هدف' : 'Goal'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'رژیم' : 'Diet'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'نقش' : 'Role'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'تاریخ عضویت' : 'Created'}</TableHead>
                        <TableHead>{i18n.language === 'fa' ? 'عملیات' : 'Actions'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">{user.email}</TableCell>
                          <TableCell>{user.age}</TableCell>
                          <TableCell>{user.weight} kg</TableCell>
                          <TableCell>{user.height} cm</TableCell>
                          <TableCell>{formatGoal(user.fitness_goal)}</TableCell>
                          <TableCell>{formatDiet(user.dietary_preference)}</TableCell>
                          <TableCell>
                            <Badge variant={user.is_admin ? "default" : "secondary"}>
                              {user.is_admin 
                                ? (i18n.language === 'fa' ? 'مدیر' : 'Admin')
                                : (i18n.language === 'fa' ? 'کاربر' : 'User')
                              }
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(user.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleAdminStatus(user.id, user.is_admin)}
                                disabled={user.id === user?.id} // Prevent self-modification
                              >
                                {user.is_admin ? (
                                  <UserX className="h-4 w-4" />
                                ) : (
                                  <UserCheck className="h-4 w-4" />
                                )}
                              </Button>
                              
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    disabled={user.id === user?.id} // Prevent self-deletion
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      {i18n.language === 'fa' ? 'حذف کاربر' : 'Delete User'}
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {i18n.language === 'fa' 
                                        ? `آیا مطمئن هستید که می‌خواهید کاربر ${user.email} را حذف کنید؟ این عمل قابل بازگشت نیست.`
                                        : `Are you sure you want to delete user ${user.email}? This action cannot be undone.`
                                      }
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      {i18n.language === 'fa' ? 'لغو' : 'Cancel'}
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteUser(user.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      {i18n.language === 'fa' ? 'حذف' : 'Delete'}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="plans" className="space-y-6">
              <Card className="gradient-card border-primary/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    {i18n.language === 'fa' ? 'مدیریت برنامه‌ها' : 'Plan Management'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingPlans ? (
                    <div className="text-center py-8">
                      <div className="text-lg">Loading plans...</div>
                    </div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{i18n.language === 'fa' ? 'ایمیل کاربر' : 'User Email'}</TableHead>
                            <TableHead>{i18n.language === 'fa' ? 'نوع برنامه' : 'Plan Type'}</TableHead>
                            <TableHead>{i18n.language === 'fa' ? 'تاریخ ایجاد' : 'Created At'}</TableHead>
                            <TableHead>{i18n.language === 'fa' ? 'عملیات' : 'Actions'}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plans.map((plan) => (
                            <TableRow key={`${plan.type}-${plan.id}`}>
                              <TableCell className="font-medium">{plan.user_email}</TableCell>
                              <TableCell>
                                <Badge variant={plan.type === 'workout' ? "default" : "secondary"} className="flex items-center gap-1 w-fit">
                                  {plan.type === 'workout' ? (
                                    <Dumbbell className="h-3 w-3" />
                                  ) : (
                                    <Apple className="h-3 w-3" />
                                  )}
                                  {plan.type === 'workout' 
                                    ? (i18n.language === 'fa' ? 'ورزشی' : 'Workout')
                                    : (i18n.language === 'fa' ? 'تغذیه' : 'Nutrition')
                                  }
                                </Badge>
                              </TableCell>
                              <TableCell>{formatDate(plan.created_at)}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSelectedPlan(plan)}
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                                      <DialogHeader>
                                        <DialogTitle className="flex items-center gap-2">
                                          {plan.type === 'workout' ? (
                                            <Dumbbell className="h-5 w-5" />
                                          ) : (
                                            <Apple className="h-5 w-5" />
                                          )}
                                          {plan.type === 'workout' 
                                            ? (i18n.language === 'fa' ? 'برنامه ورزشی' : 'Workout Plan')
                                            : (i18n.language === 'fa' ? 'برنامه تغذیه' : 'Nutrition Plan')
                                          } - {plan.user_email}
                                        </DialogTitle>
                                        <DialogDescription>
                                          {i18n.language === 'fa' ? 'جزئیات کامل برنامه' : 'Full plan details'}
                                        </DialogDescription>
                                      </DialogHeader>
                                      {selectedPlan?.id === plan.id && (
                                        <div className="space-y-4">
                                          {plan.type === 'workout' ? (
                                            <div className="space-y-6">
                                              {Object.entries(plan.content).map(([week, days]: [string, any]) => (
                                                <div key={week} className="space-y-4">
                                                  <h3 className="text-lg font-semibold capitalize text-primary">
                                                    {week.replace(/([A-Z])/g, ' $1').trim()}
                                                  </h3>
                                                  <div className="grid gap-4">
                                                    {days.map((day: any, dayIndex: number) => (
                                                      <Card key={dayIndex} className="border-primary/10">
                                                        <CardHeader className="pb-3">
                                                          <CardTitle className="text-base">{day.day}</CardTitle>
                                                        </CardHeader>
                                                        <CardContent>
                                                          <div className="space-y-2">
                                                            {day.exercises.map((exercise: any, exerciseIndex: number) => (
                                                              <div key={exerciseIndex} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                                                                <div>
                                                                  <span className="font-medium">{exercise.name}</span>
                                                                </div>
                                                                <div className="text-sm text-muted-foreground">
                                                                  {exercise.sets} sets × {exercise.reps} • {exercise.rest}
                                                                </div>
                                                              </div>
                                                            ))}
                                                          </div>
                                                        </CardContent>
                                                      </Card>
                                                    ))}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="space-y-6">
                                              {Object.entries(plan.content).map(([mealType, meals]: [string, any]) => (
                                                <div key={mealType} className="space-y-3">
                                                  <h3 className="text-lg font-semibold capitalize text-primary">{mealType}</h3>
                                                  <div className="grid gap-3">
                                                    {meals.map((meal: any, mealIndex: number) => (
                                                      <Card key={mealIndex} className="border-primary/10">
                                                        <CardContent className="p-4">
                                                          <div className="flex justify-between items-start">
                                                            <div className="flex-1">
                                                              <h4 className="font-medium">{meal.meal}</h4>
                                                              <p className="text-sm text-muted-foreground mt-1">{meal.description}</p>
                                                            </div>
                                                            <Badge variant="secondary" className="ml-3">
                                                              {meal.calories} cal
                                                            </Badge>
                                                          </div>
                                                        </CardContent>
                                                      </Card>
                                                    ))}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </DialogContent>
                                  </Dialog>

                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => regeneratePlan(plan.user_id, plan.type)}
                                    disabled={regeneratingPlan === `${plan.user_id}-${plan.type}`}
                                  >
                                    <RefreshCw className={`h-4 w-4 ${regeneratingPlan === `${plan.user_id}-${plan.type}` ? 'animate-spin' : ''}`} />
                                  </Button>

                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button 
                                        variant="outline" 
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          {i18n.language === 'fa' ? 'حذف برنامه' : 'Delete Plan'}
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          {i18n.language === 'fa' 
                                            ? `آیا مطمئن هستید که می‌خواهید این برنامه ${plan.type === 'workout' ? 'ورزشی' : 'تغذیه'} را حذف کنید؟ این عمل قابل بازگشت نیست.`
                                            : `Are you sure you want to delete this ${plan.type} plan? This action cannot be undone.`
                                          }
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>
                                          {i18n.language === 'fa' ? 'لغو' : 'Cancel'}
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => deletePlan(plan.id, plan.type)}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          {i18n.language === 'fa' ? 'حذف' : 'Delete'}
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
    );
  };

export default AdminPanel;