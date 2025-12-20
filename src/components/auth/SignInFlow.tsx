import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp";
import { CanvasRevealEffect } from "./CanvasRevealEffect";

export default function SignInFlow() {
    const [step, setStep] = useState<"email" | "otp" | "success">("email");
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [loading, setLoading] = useState(false);
    const [showReverseCanvas, setShowReverseCanvas] = useState(false);

    const handleSendOtp = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            toast.error("Please enter a valid email address");
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: false, // Strict: only existing users
                },
            });

            if (error) {
                // If error is related to "Signups not allowed" or similar
                if (
                    error.message.toLowerCase().includes("signups not allowed") ||
                    error.status === 400 ||
                    error.status === 422
                ) {
                    toast.error("Account not found. Please contact support.");
                } else {
                    throw error;
                }
                return;
            }

            toast.success("Code sent to your inbox!");
            setStep("otp");
        } catch (error: any) {
            toast.error(error.message || "Failed to send code");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (code: string) => {
        if (code.length !== 6) return;

        setLoading(true);
        try {
            const { error } = await supabase.auth.verifyOtp({
                email,
                token: code,
                type: "email",
            });

            if (error) throw error;

            // Success animation
            setStep("success");
            setShowReverseCanvas(true);
            // Redirect handled by AuthPage's useEffect on user state change
        } catch (error: any) {
            toast.error("Invalid code. Please try again.");
            setOtp("");
        } finally {
            setLoading(false);
        }
    };

    const onSignupClick = () => {
        toast("Registration coming soon", {
            description: "We are currently in private beta.",
        });
    };

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden bg-black text-white font-sans selection:bg-emerald-500/30">

            {/* Background Layers */}
            <div className="absolute inset-0 z-0">
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
                                animationSpeed={5.0} // Faster chaotic reveal
                                containerClassName="bg-emerald-950"
                                colors={[[255, 255, 255]]}
                                dotSize={4}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Mini Navbar */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="fixed top-8 z-20"
            >
                <div className="flex items-center gap-1 p-1 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-800">
                    <button
                        className="px-6 py-2 rounded-full text-sm font-medium bg-zinc-800 text-white shadow-sm transition-all"
                    >
                        Login
                    </button>
                    <button
                        onClick={onSignupClick}
                        className="px-6 py-2 rounded-full text-sm font-medium text-zinc-400 hover:text-white transition-all"
                    >
                        Sign up
                    </button>
                </div>
            </motion.div>

            {/* Content Container */}
            <div className="z-20 w-full max-w-md px-4">
                <AnimatePresence mode="wait">
                    {step === "email" && (
                        <motion.div
                            key="email"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center"
                        >
                            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-4 text-white">
                                Welcome back
                            </h1>
                            <p className="text-zinc-400 mb-8 max-w-xs mx-auto">
                                Enter your email to access your personalized fitness coach.
                            </p>

                            <form onSubmit={handleSendOtp} className="w-full max-w-sm relative group">
                                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                                <div className="relative">
                                    <Input
                                        type="email"
                                        placeholder="name@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="h-14 bg-zinc-900/90 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-full pl-6 pr-14 hover:border-zinc-700 text-lg"
                                        disabled={loading}
                                        autoFocus
                                    />
                                    <button
                                        type="submit"
                                        disabled={loading || !email}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-emerald-500 text-black hover:bg-emerald-400 transition-all disabled:opacity-0 disabled:scale-75 disabled:pointer-events-none"
                                    >
                                        <ArrowRight size={20} />
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    )}

                    {step === "otp" && (
                        <motion.div
                            key="otp"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.3 }}
                            className="flex flex-col items-center text-center w-full"
                        >
                            <button
                                onClick={() => setStep("email")}
                                className="mb-6 flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors"
                            >
                                <ArrowLeft size={14} /> Back to email
                            </button>

                            <h2 className="text-3xl font-bold tracking-tight mb-2 text-white">
                                Verify your email
                            </h2>
                            <p className="text-zinc-400 mb-8">
                                Enter the code sent to <span className="text-white font-medium">{email}</span>
                            </p>

                            <InputOTP
                                maxLength={6}
                                value={otp}
                                onChange={(val) => {
                                    setOtp(val);
                                    if (val.length === 6) handleVerifyOtp(val);
                                }}
                                disabled={loading}
                                className="gap-2 sm:gap-4"
                            >
                                <InputOTPGroup className="gap-2 sm:gap-3">
                                    {[0, 1, 2, 3, 4, 5].map((index) => (
                                        <InputOTPSlot
                                            key={index}
                                            index={index}
                                            className="w-10 h-12 sm:w-12 sm:h-14 border border-zinc-800 rounded-xl bg-zinc-900/50 text-white text-xl sm:text-2xl font-bold transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                                        />
                                    ))}
                                </InputOTPGroup>
                            </InputOTP>

                            {loading && (
                                <motion.p
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="mt-6 text-sm text-zinc-500 animate-pulse"
                                >
                                    Verifying code...
                                </motion.p>
                            )}
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
                                <svg
                                    width="40"
                                    height="40"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <motion.path
                                        initial={{ pathLength: 0 }}
                                        animate={{ pathLength: 1 }}
                                        transition={{ duration: 0.4, delay: 0.2 }}
                                        d="M20 6L9 17l-5-5"
                                    />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold text-white">Welcome back</h2>
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
