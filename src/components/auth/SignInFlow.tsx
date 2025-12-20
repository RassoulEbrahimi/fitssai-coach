import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Lock, Mail, Eye, EyeOff, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { CanvasRevealEffect } from "./CanvasRevealEffect";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

export default function SignInFlow() {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
    const [step, setStep] = useState<"auth" | "success">("auth");

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showReverseCanvas, setShowReverseCanvas] = useState(false);

    // Logging for debugging
    useEffect(() => {
        console.log("Auth State:", { user: !!user, step, mode });
    }, [user, step, mode]);

    // Redirect if already logged in and not in the middle of success sequence
    useEffect(() => {
        if (user && step === "auth" && !loading) {
            navigate("/dashboard");
        }
    }, [user, step, navigate, loading]);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            toast.error("Please enter a valid email address");
            return;
        }

        setLoading(true);

        try {
            if (mode === "forgot") {
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/auth/reset`,
                });
                if (error) throw error;
                toast.success("Password reset link sent to your email!");
                setMode("login");
            } else if (mode === "signup") {
                if (password.length < 6) {
                    toast.error("Password must be at least 6 characters");
                    setLoading(false);
                    return;
                }
                if (password !== confirmPassword) {
                    toast.error("Passwords do not match");
                    setLoading(false);
                    return;
                }

                const { error, data } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;

                if (data.session) {
                    handleSuccess();
                } else if (data.user && !data.session) {
                    toast.success("Account created! Please check your email to confirm.");
                    setMode("login");
                }
            } else {
                // Login
                const { error, data } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) {
                    if (error.message === "Invalid login credentials") {
                        toast.error("Invalid email or password");
                    } else {
                        throw error;
                    }
                    setLoading(false);
                    return;
                }

                if (data.session) {
                    handleSuccess();
                }
            }
        } catch (error: any) {
            toast.error(error.message || "Authentication failed");
        } finally {
            if (step !== "success") setLoading(false);
        }
    };

    const handleSuccess = () => {
        setStep("success");
        setShowReverseCanvas(true);
        setTimeout(async () => {
            navigate("/dashboard");
        }, 1500);
    };

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-black text-white font-sans selection:bg-emerald-500/30">

            {/* Background Layers */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <AnimatePresence>
                    {!showReverseCanvas && (
                        <motion.div
                            initial={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1 }}
                            className="absolute inset-0"
                        >
                            <CanvasRevealEffect
                                animationSpeed={3.0}
                                containerClassName="bg-black"
                                colors={[[0, 255, 163]]} // Emerald/Teal
                                opacities={[0.2, 0.2, 0.2, 0.2, 0.2, 0.4, 0.4, 0.4, 0.4, 1]}
                                dotSize={2}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Reverse Layer for Success */}
                <AnimatePresence>
                    {showReverseCanvas && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.5 }}
                            className="absolute inset-0 z-10"
                        >
                            <CanvasRevealEffect
                                animationSpeed={5.0}
                                containerClassName="bg-emerald-950"
                                colors={[[255, 255, 255]]}
                                dotSize={4}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Mini Navbar (Toggle) */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="fixed top-8 z-20"
            >
                {mode !== "forgot" && (
                    <div className="flex items-center gap-1 p-1 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-800">
                        <button
                            onClick={() => setMode("login")}
                            className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${mode === "login"
                                ? "bg-zinc-800 text-white shadow-sm"
                                : "text-zinc-400 hover:text-white"
                                }`}
                            disabled={loading || step === "success"}
                        >
                            Login
                        </button>
                        <button
                            onClick={() => setMode("signup")}
                            className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${mode === "signup"
                                ? "bg-zinc-800 text-white shadow-sm"
                                : "text-zinc-400 hover:text-white"
                                }`}
                            disabled={loading || step === "success"}
                        >
                            Sign up
                        </button>
                    </div>
                )}
            </motion.div>

            {/* Content Container */}
            <div className="z-20 w-full max-w-md px-4">
                <AnimatePresence mode="wait">
                    {step === "auth" && (
                        <motion.div
                            key="auth"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center"
                        >
                            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-4 text-white">
                                {mode === "login" ? "Welcome back" : mode === "signup" ? "Start your journey" : "Reset Password"}
                            </h1>
                            <p className="text-zinc-400 mb-8 max-w-xs mx-auto">
                                {mode === "login"
                                    ? "Enter your credentials to access your coach."
                                    : mode === "signup"
                                        ? "Create an account to get your AI training plan."
                                        : "Enter your email to receive a reset link."}
                            </p>

                            <form onSubmit={handleAuth} className="w-full max-w-sm relative group space-y-4">
                                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />

                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                    <Input
                                        type="email"
                                        placeholder="Email address"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-4 hover:border-zinc-700 text-lg"
                                        disabled={loading}
                                        autoFocus
                                    />
                                </div>

                                {mode !== "forgot" && (
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-12 hover:border-zinc-700 text-lg"
                                            disabled={loading}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                                        >
                                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                )}

                                {mode === "signup" && (
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Confirm Password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-12 hover:border-zinc-700 text-lg"
                                            disabled={loading}
                                        />
                                    </div>
                                )}

                                <div className="flex flex-col gap-4 pt-2">
                                    <button
                                        type="submit"
                                        disabled={loading || !email || (mode !== "forgot" && !password)}
                                        className="w-full h-14 flex items-center justify-center rounded-full bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:pointer-events-none text-lg"
                                    >
                                        {loading ? <Loader2 className="animate-spin" size={24} /> :
                                            <span className="flex items-center gap-2">
                                                {mode === "login" ? "Login" : mode === "signup" ? "Sign Up" : "Send Link"}
                                                <ArrowRight size={20} />
                                            </span>
                                        }
                                    </button>

                                    {mode === "login" && (
                                        <button
                                            type="button"
                                            onClick={() => setMode("forgot")}
                                            className="text-sm text-zinc-500 hover:text-white transition-colors"
                                        >
                                            Forgot password?
                                        </button>
                                    )}

                                    {mode === "forgot" && (
                                        <button
                                            type="button"
                                            onClick={() => setMode("login")}
                                            className="text-sm text-zinc-500 hover:text-white transition-colors"
                                        >
                                            Back to Login
                                        </button>
                                    )}
                                </div>
                            </form>
                        </motion.div>
                    )}

                    {step === "success" && (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex flex-col items-center justify-center text-center space-y-4 pt-4 relative z-50"
                        >
                            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center text-black shadow-[0_0_50px_-5px_rgba(16,185,129,0.7)]">
                                <CheckCircle size={40} strokeWidth={2.5} />
                            </div>
                            <h2 className="text-3xl font-bold text-white">
                                {mode === "login" || mode === "forgot" ? "Welcome back" : "Account Created"}
                            </h2>
                            <p className="text-zinc-300">Redirecting to your dashboard...</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="absolute bottom-8 text-center z-20">
                <p className="text-xs text-zinc-800 font-medium tracking-widest uppercase">
                    FitssAI Secure System
                </p>
            </div>
        </div>
    );
}
