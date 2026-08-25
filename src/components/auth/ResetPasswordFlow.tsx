import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Lock } from "lucide-react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function ResetPasswordFlow() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();
    const oobCode = searchParams.get("oobCode");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [validatingCode, setValidatingCode] = useState(true);
    const [codeError, setCodeError] = useState("");

    useEffect(() => {
        let mounted = true;

        const validateCode = async () => {
            if (!oobCode) {
                if (mounted) {
                    setCodeError(t("auth.resetCodeMissing"));
                    setValidatingCode(false);
                }
                return;
            }

            try {
                await verifyPasswordResetCode(auth, oobCode);
            } catch {
                if (mounted) {
                    setCodeError(t("auth.resetCodeInvalid"));
                }
            } finally {
                if (mounted) {
                    setValidatingCode(false);
                }
            }
        };

        validateCode();

        return () => {
            mounted = false;
        };
    }, [oobCode, t]);

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!oobCode || codeError) {
            toast.error(codeError || t("auth.resetCodeMissing"));
            return;
        }
        if (password.length < 6) {
            toast.error(t("auth.passwordTooShort"));
            return;
        }
        setLoading(true);
        try {
            await confirmPasswordReset(auth, oobCode, password);
            toast.success(t("auth.passwordUpdated"));
            setTimeout(() => navigate("/auth/sign-in"), 1000);
        } catch (error: any) {
            toast.error(error.message || t("auth.passwordUpdateFailed"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-black text-white font-sans selection:bg-emerald-500/30">
            <div className="z-20 w-full max-w-md px-4">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-col items-center text-center">
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-4 text-white">{t("auth.resetPassword")}</h1>
                    <p className="text-zinc-400 mb-8 max-w-xs mx-auto">{t("auth.resetSubtitle")}</p>
                    {codeError && (
                        <div className="mb-6 w-full max-w-sm rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                            <p>{codeError}</p>
                            <button type="button" onClick={() => navigate("/auth/sign-in")} className="mt-3 font-semibold text-emerald-300 hover:text-emerald-200">
                                {t("auth.backToSignIn")}
                            </button>
                        </div>
                    )}
                    <form onSubmit={handleResetPassword} className="w-full max-w-sm relative group space-y-4">
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                            <Input type="password" placeholder={t("auth.newPassword")} value={password} onChange={(e) => setPassword(e.target.value)} className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-4 hover:border-zinc-700 text-lg" disabled={loading || validatingCode || !!codeError} autoFocus />
                        </div>
                        <button type="submit" disabled={loading || validatingCode || !!codeError || !password} className="w-full h-14 flex items-center justify-center rounded-full bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:pointer-events-none">
                            {loading || validatingCode ? <Loader2 className="animate-spin" size={20} /> : <span className="flex items-center gap-2">{t("auth.updatePassword")} <ArrowRight size={20} /></span>}
                        </button>
                    </form>
                </motion.div>
            </div>
            <div className="absolute bottom-8 text-center z-20">
                <p className="text-xs text-zinc-800 font-medium tracking-widest uppercase">{t("auth.secureSystem")}</p>
            </div>
        </div>
    );
}
