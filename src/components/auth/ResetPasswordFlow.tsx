import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { CanvasRevealEffect } from "./CanvasRevealEffect";
import { useNavigate } from "react-router-dom";

export default function ResetPasswordFlow() {
    const navigate = useNavigate();
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    // We expect the user to land here with a session recovery token handled by Supabase automatically, 
    // or be already logged in if they clicked a link.
    // Ideally, supabase.auth.onAuthStateChange handles the session recovery.

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 6) {
            toast.error("Password must be at least 6 characters");
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: password });
            if (error) throw error;

            toast.success("Password updated successfully!");
            setTimeout(() => {
                navigate("/dashboard");
            }, 1000);
        } catch (error: any) {
            toast.error(error.message || "Failed to update password");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-black text-white font-sans selection:bg-emerald-500/30">
            {/* Background Layers */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <CanvasRevealEffect
                    animationSpeed={3.0}
                    containerClassName="bg-black"
                    colors={[[0, 255, 163]]} // Emerald/Teal
                    opacities={[0.2, 0.2, 0.2, 0.2, 0.2, 0.4, 0.4, 0.4, 0.4, 1]}
                    dotSize={2}
                />
            </div>

            {/* Content Container */}
            <div className="z-20 w-full max-w-md px-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col items-center text-center"
                >
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-4 text-white">
                        Reset Password
                    </h1>
                    <p className="text-zinc-400 mb-8 max-w-xs mx-auto">
                        Enter your new password below.
                    </p>

                    <form onSubmit={handleResetPassword} className="w-full max-w-sm relative group space-y-4">
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                            <Input
                                type="password"
                                placeholder="New Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-12 pr-4 hover:border-zinc-700 text-lg"
                                disabled={loading}
                                autoFocus
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !password}
                            className="w-full h-14 flex items-center justify-center rounded-full bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {loading ? <Loader2 className="animate-spin" size={20} /> : <span className="flex items-center gap-2">Update Password <ArrowRight size={20} /></span>}
                        </button>
                    </form>
                </motion.div>
            </div>

            <div className="absolute bottom-8 text-center z-20">
                <p className="text-xs text-zinc-800 font-medium tracking-widest uppercase">
                    FitssAI Secure System
                </p>
            </div>
        </div>
    );
}
