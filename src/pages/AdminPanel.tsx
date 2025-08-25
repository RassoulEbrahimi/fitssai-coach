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
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
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
  UserX
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

const AdminPanel = () => {
  const { user, loading } = useAuth();
  const { t, i18n } = useTranslation();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (user) {
      checkAdminStatus();
      fetchAllUsers();
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
        const authUser = authUsers.users.find(au => au.id === profile.id);
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
          </div>

          {/* Users Table */}
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
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;