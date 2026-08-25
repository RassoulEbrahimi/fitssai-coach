import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Lock, Mail, Eye, EyeOff, CheckCircle } from "lucide-react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authPathForMode, type AuthMode } from "@/lib/authRoutes";
import LegalFooter from "@/components/LegalFooter";

export default function SignInFlow({ initialMode = "login" }: { initialMode?: AuthMode } = {}) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const [mode, setMode] = useState<AuthMode>(initialMode);

    // Follow the route when the user navigates between /auth/sign-in and
    // /auth/sign-up (including via browser back/forward).
    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);

    /** Switch form mode and keep the URL in step, so the two never disagree. */
    const switchMode = (next: AuthMode) => {
        setMode(next);
        if (next !== "forgot") {
            navigate(authPathForMode(next), { replace: true });
        }
    };
    const [step, setStep] = useState<"auth" | "success">("auth");

    const [email, setEmail]                   = useState("");
    const [password, setPassword]             = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [showPassword, setShowPassword]       = useState(false);
    const [loading, setLoading]                 = useState(false);

    useEffect(() => {
        if (user && step === "auth" && !loading) {
            navigate("/dashboard");
        }
    }, [user, step, navigate, loading]);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            toast.error(t("auth.invalidEmail"));
            return;
        }

        setLoading(true);

        try {
            if (mode === "forgot") {
                await sendPasswordResetEmail(auth, email);
                toast.success(t("auth.resetLinkSent"));
                switchMode("login");
            } else if (mode === "signup") {
                if (password.length < 6) {
                    toast.error(t("auth.passwordTooShort"));
                    setLoading(false);
                    return;
                }
                if (password !== confirmPassword) {
                    toast.error(t("auth.passwordsDoNotMatch"));
                    setLoading(false);
                    return;
                }
                await createUserWithEmailAndPassword(auth, email, password);
                handleSuccess();
            } else {
                try {
                    await signInWithEmailAndPassword(auth, email, password);
                    handleSuccess();
                } catch (err: any) {
                    const code = err?.code || "";
                    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
                        toast.error(t("auth.invalidCredentials"));
                    } else {
                        toast.error(err.message || t("auth.authFailed"));
                    }
                    setLoading(false);
                    return;
                }
            }
        } catch (error: any) {
            toast.error(error.message || t("auth.authFailed"));
        } finally {
            if (step !== "success") setLoading(false);
        }
    };

    const handleSuccess = () => {
        setStep("success");
        setTimeout(() => { navigate("/dashboard"); }, 1500);
    };

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-black text-white font-sans selection:bg-emerald-500/30">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="fixed top-8 z-20">
                {mode !== "forgot" && (
                    <div className="flex items-center gap-1 p-1 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-800">
                        <button type="button" onClick={() => switchMode("login")} aria-pressed={mode === "login"} className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${mode === "login" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-white"}`} disabled={loading || step === "success"}>{t("auth.login")}</button>
                        <button type="button" onClick={() => switchMode("signup")} aria-pressed={mode === "signup"} className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${mode === "signup" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-white"}`} disabled={loading || step === "success"}>{t("auth.register")}</button>
                    </div>
                )}
            </motion.div>

            <div className="z-20 w-full max-w-md px-4">
                <AnimatePresence mode="wait">
                    {step === "auth" && (
                        <motion.div key="auth" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.3 }} className="flex flex-col items-center text-center">
                            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-4 text-white">
                                {mode === "login" ? t("auth.welcomeBack") : mode === "signup" ? t("auth.startJourney") : t("auth.resetPassword")}
                            </h1>
                            <p className="text-zinc-400 mb-8 max-w-xs mx-auto">
                                {mode === "login" ? t("auth.loginSubtitle") : mode === "signup" ? t("auth.signupSubtitle") : t("auth.forgotSubtitle")}
                            </p>
                            <form onSubmit={handleAuth} className="w-full max-w-sm relative group space-y-4">
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                    <label htmlFor="auth-email" className="sr-only">{t("auth.emailPlaceholder")}</label>
                                    <Input id="auth-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-4 hover:border-zinc-700 text-lg" disabled={loading} autoFocus />
                                </div>
                                {mode !== "forgot" && (
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                        <label htmlFor="auth-password" className="sr-only">{t("auth.passwordPlaceholder")}</label>
                                        <Input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)} className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-12 hover:border-zinc-700 text-lg" disabled={loading} />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={showPassword} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors">{showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button>
                                    </div>
                                )}
                                {mode === "signup" && (
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                                        <label htmlFor="auth-confirm-password" className="sr-only">{t("auth.confirmPassword")}</label>
                                        <Input id="auth-confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder={t("auth.confirmPassword")} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-12 hover:border-zinc-700 text-lg" disabled={loading} />
                                    </div>
                                )}
                                <div className="flex flex-col gap-4 pt-2">
                                    <button type="submit" disabled={loading || !email || (mode !== "forgot" && !password)} className="w-full h-14 flex items-center justify-center rounded-full bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:pointer-events-none text-lg">
                                        {loading ? <Loader2 className="animate-spin" size={24} /> : <span className="flex items-center gap-2">{mode === "login" ? t("auth.login") : mode === "signup" ? t("auth.register") : t("auth.sendLink")}<ArrowRight size={20} /></span>}
                                    </button>
                                    {mode === "login" && <button type="button" onClick={() => switchMode("forgot")} className="text-sm text-zinc-500 hover:text-white transition-colors">{t("auth.forgotPassword")}</button>}
                                    {mode === "forgot" && <button type="button" onClick={() => switchMode("login")} className="text-sm text-zinc-500 hover:text-white transition-colors">{t("auth.backToLogin")}</button>}
                                </div>
                            </form>
                        </motion.div>
                    )}
                    {step === "success" && (
                        <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center text-center space-y-4 pt-4 relative z-50">
                            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center text-black shadow-[0_0_50px_-5px_rgba(16,185,129,0.7)]"><CheckCircle size={40} strokeWidth={2.5} /></div>
                            <h2 className="text-3xl font-bold text-white">{mode === "login" || mode === "forgot" ? t("auth.welcomeBack") : t("auth.accountCreated")}</h2>
                            <p className="text-zinc-300">{t("auth.redirecting")}</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="absolute bottom-8 text-center z-20 space-y-2">
                <p className="text-xs text-zinc-800 font-medium tracking-widest uppercase">{t("auth.secureSystem")}</p>
                <LegalFooter />
            </div>
        </div>
    );
}
