import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isValid, parseISO } from 'date-fns';
import { formatDateForDisplay } from '@/lib/dateUtils';
import { fitnessGoalLabel } from '@/lib/coaching/fitnessGoal';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { collection, doc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
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

interface AuthUser {
  id: string;
  email?: string;
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

  // Admin data is fetched directly from Firestore (edge functions removed)
  const fetchAllUsersFromFirestore = async () => {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id:                 d.id,
        email:              data.email        ?? '',
        age:                data.age          ?? null,
        weight:             data.weight       ?? null,
        height:             data.height       ?? null,
        fitness_goal:       data.fitnessGoal  ?? '',
        dietary_preference: data.dietaryPreference ?? '',
        is_admin:           data.role === 'admin',
        created_at:         data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : '',
      };
    });
  };

  const checkAdminStatus = async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      setIsAdmin(snap.exists() && snap.data()?.role === 'admin');
    } catch {
      setIsAdmin(false);
    } finally {
      setCheckingAdmin(false);
    }
  };

  const fetchAllUsers = async () => {
    try {
      const users = await fetchAllUsersFromFirestore();
      setUsers(users);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Benutzer konnten nicht geladen werden');
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchAllPlans = async () => {
    try {
      const allUsers = await fetchAllUsersFromFirestore();
      const plans: Plan[] = [];
      for (const u of allUsers) {
        const [wpSnap, npSnap] = await Promise.all([
          getDocs(collection(db, 'users', u.id, 'workout_plans')),
          getDocs(collection(db, 'users', u.id, 'nutrition_plans')),
        ]);
        wpSnap.forEach(d => {
          const data = d.data();
          plans.push({ id: d.id, user_id: u.id, content: data.content, created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : '', type: 'workout', user_email: u.email });
        });
        npSnap.forEach(d => {
          const data = d.data();
          plans.push({ id: d.id, user_id: u.id, content: data.content, created_at: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : '', type: 'nutrition', user_email: u.email });
        });
      }
      setPlans(plans);
    } catch (error) {
      console.error('Error fetching plans:', error);
      toast.error('Pläne konnten nicht geladen werden');
    } finally {
      setLoadingPlans(false);
    }
  };

  const deleteUser = async (_userId: string) => {
    // User deletion requires Firebase Admin SDK (Cloud Function) — temporarily disabled
    toast.error('Benutzer-Löschung vorübergehend deaktiviert', {
      description: 'Erfordert Firebase Cloud Functions (Blaze-Plan).',
    });
  };

  const regeneratePlan = async (_planUserId: string, _planType: 'workout' | 'nutrition') => {
    toast.info('KI-Plan-Generierung vorübergehend deaktiviert', {
      description: 'Erfordert Firebase Cloud Functions (Blaze-Plan).',
    });
  };

  const deletePlan = async (planId: string, planType: 'workout' | 'nutrition') => {
    try {
      const subcol = planType === 'workout' ? 'workout_plans' : 'nutrition_plans';
      // Find which user owns this plan
      const ownerPlan = plans.find(p => p.id === planId);
      if (!ownerPlan) throw new Error('Plan not found');
      const { deleteDoc, doc: fsDoc } = await import('firebase/firestore');
      await deleteDoc(fsDoc(db, 'users', ownerPlan.user_id, subcol, planId));
      setPlans(plans.filter(plan => plan.id !== planId));
      toast.success('Plan deleted successfully');
    } catch (error) {
      console.error('Error deleting plan:', error);
      toast.error('Failed to delete plan');
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    const date = parseISO(dateString);
    return isValid(date) ? formatDateForDisplay(date, 'EEEE, d. MMMM') : '-';
  };

  // One canonical goal vocabulary, shared with the profile and the coaching
  // layer: this map only knew the kebab-case catalogue keys, so a stored
  // "gainMuscle" fell through and was shown raw.
  const formatGoal = (goal: string) => fitnessGoalLabel(goal) ?? goal;

  const formatDiet = (diet: string) => {
    const dietMap: Record<string, string> = {
      'no-preference': 'Keine Präferenz',
      'vegetarian': 'Vegetarisch',
      'vegan': 'Vegan',
      'keto': 'Keto',
      'high-protein': 'Proteinreich'
    };
    return dietMap[diet] || diet;
  };

  if (loading || checkingAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <div className="pt-4 flex items-center justify-center min-h-screen">
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
      <div className="pt-4">
        <div className="max-w-7xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">
                Adminbereich
              </h1>
            </div>
            <p className="text-muted-foreground">
              Benutzer und Systemzugriff verwalten
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="gradient-card border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Benutzer gesamt
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
                      Admins
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
                      Normale Benutzer
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
                      Pläne gesamt
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
                Benutzer
              </TabsTrigger>
              <TabsTrigger value="plans" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Pläne
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="space-y-6">
              <Card className="gradient-card border-primary/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    Benutzerverwaltung
                  </CardTitle>
                </CardHeader>
                <CardContent>
              {loadingUsers ? (
                <div className="text-center py-8">
                  <div className="text-lg">Loading users...</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/*
                    The role toggle that used to sit in this table wrote another
                    user's `role` field straight from the browser. Firestore
                    refuses that write, so the button could only ever fail —
                    and a client that can grant itself admin is not a security
                    boundary at all. Saying so is better than a control that
                    silently does nothing.
                  */}
                  <p className="text-sm text-muted-foreground" role="note">
                    Rollen lassen sich hier nicht ändern. Die Vergabe von
                    Admin-Rechten erfolgt serverseitig und ist über die App
                    nicht möglich.
                  </p>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>E-Mail</TableHead>
                        <TableHead>Alter</TableHead>
                        <TableHead>Gewicht</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead>Ziel</TableHead>
                        <TableHead>Diät</TableHead>
                        <TableHead>Rolle</TableHead>
                        <TableHead>Erstellt</TableHead>
                        <TableHead>Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((profileUser) => (
                        <TableRow key={profileUser.id}>
                          <TableCell className="font-medium">{profileUser.email}</TableCell>
                          <TableCell>{profileUser.age}</TableCell>
                          <TableCell>{profileUser.weight} kg</TableCell>
                          <TableCell>{profileUser.height} cm</TableCell>
                          <TableCell>{formatGoal(profileUser.fitness_goal)}</TableCell>
                          <TableCell>{formatDiet(profileUser.dietary_preference)}</TableCell>
                          <TableCell>
                            <Badge variant={profileUser.is_admin ? "default" : "secondary"}>
                              {profileUser.is_admin ? 'Admin' : 'Benutzer'}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(profileUser.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    disabled={profileUser.id === user?.uid} // Prevent self-deletion
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                     <AlertDialogTitle>
                                       Benutzer löschen
                                     </AlertDialogTitle>
                                     <AlertDialogDescription>
                                       Sind Sie sicher, dass Sie den Benutzer ${profileUser.email} löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.
                                     </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                     <AlertDialogCancel>
                                       Abbrechen
                                     </AlertDialogCancel>
                                     <AlertDialogAction
                                       onClick={() => deleteUser(profileUser.id)}
                                       className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                     >
                                       Löschen
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
                    Planverwaltung
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
                            <TableHead>Benutzer E-Mail</TableHead>
                            <TableHead>Plantyp</TableHead>
                            <TableHead>Erstellt am</TableHead>
                            <TableHead>Aktionen</TableHead>
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
                                  {plan.type === 'workout' ? 'Training' : 'Ernährung'}
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
                          {plan.type === 'workout' ? 'Trainingsplan' : 'Ernährungsplan'} - {plan.user_email}
                                        </DialogTitle>
                        <DialogDescription>
                          Vollständige Plandetails
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
                                          Plan löschen
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Sind Sie sicher, dass Sie diesen ${plan.type === 'workout' ? 'Trainings' : 'Ernährungs'}plan löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>
                                          Abbrechen
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => deletePlan(plan.id, plan.type)}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          Löschen
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
