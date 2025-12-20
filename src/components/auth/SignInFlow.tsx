import { useState, useEffect } from "react";
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
import { Link } from "react-router-dom";

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
                // Supabase might return specific error codes.
                if (error.message.includes("Signups not allowed") || error.status === 400) {
                    toast.error("Account not found. Please sign up first.");
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

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-black text-white font-sans selection:bg-emerald-500/30">

            {/* Background Layers */}
            <AnimatePresence>
                {!showReverseCanvas && (
                    <motion.div
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0 z-0"
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
                        className="absolute inset-0 z-0"
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


            {/* Content Container */}
            <div className="z-10 w-full max-w-md px-8">

                {/* Header / Logo */}
                <div className="mb-12 flex flex-col items-center">
                    {/* Mini "Pill" Navbar imitation (optional, based on request "Keep the top mini-navbar look only if it exists") 
                 The requests said "MiniNavbar" was in the previous version and removed, but then "Keep only email -> code flow UI".
                 Later "Keep the top mini-navbar look... only if it exists in the reference". 
                 I'll add a simple top-left brand if needed, or just center logo. 
                 The user *removed* navbar in step 1. But requested "MiniNavbar" look in step 2 if in reference. 
                 I will keep it clean/centered for now as per "Keep only email -> code flow UI".
             */}

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center"
                    >
                        <h1 className="text-4xl font-bold tracking-tighter mb-2 bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                            FitssAI
                        </h1>
                        <p className="text-white/50 text-sm font-medium">
                            Enter your email to continue
                        </p>
                    </motion.div>
                </div>

                <div className="relative min-h-[160px]">
                    <AnimatePresence mode="wait">
                        {step === "email" && (
                            <motion.div
                                key="email"
                                initial={{ opacity: 0, x: -50 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 50 }}
                                transition={{ duration: 0.3, ease: "easeInOut" }}
                            >
                                <form onSubmit={handleSendOtp} className="space-y-4">
                                    <div className="relative group">
                                        <Input
                                            type="email"
                                            placeholder="name@example.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="h-12 bg-zinc-900/50 border-zinc-800 text-white placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all rounded-xl pl-4 pr-12 hover:border-zinc-700"
                                            disabled={loading}
                                            autoFocus
                                        />
                                        <button
                                            type="submit"
                                            disabled={loading || !email}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-0 disabled:pointer-events-none"
                                        >
                                            <ArrowRight size={18} />
                                        </button>
                                    </div>
                                </form>
                            </motion.div>
                        )}

                        {step === "otp" && (
                            <motion.div
                                key="otp"
                                initial={{ opacity: 0, x: 50 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -50 }}
                                transition={{ duration: 0.3 }}
                                className="space-y-6 text-center"
                            >
                                <div className="flex flex-col items-center gap-4">
                                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                                        <button onClick={() => setStep("email")} className="hover:text-white transition-colors flex items-center gap-1">
                                            <ArrowLeft size={14} /> {email}
                                        </button>
                                    </div>

                                    <InputOTP
                                        maxLength={6}
                                        value={otp}
                                        onChange={(val) => {
                                            setOtp(val);
                                            if (val.length === 6) handleVerifyOtp(val);
                                        }}
                                        disabled={loading}
                                        className="gap-2"
                                    >
                                        <InputOTPGroup className="gap-2">
                                            {[0, 1, 2, 3, 4, 5].map((index) => (
                                                <InputOTPSlot
                                                    key={index}
                                                    index={index}
                                                    className="w-10 h-10 border border-zinc-800 rounded-lg bg-zinc-900/50 text-white text-lg font-medium transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                                                />
                                            ))}
                                        </InputOTPGroup>
                                    </InputOTP>

                                    {loading && <p className="text-zinc-500 text-sm animate-pulse">Verifying...</p>}
                                </div>
                            </motion.div>
                        )}

                        {step === "success" && (
                            <motion.div
                                key="success"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center text-center space-y-4 pt-4"
                            >
                                <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-black shadow-[0_0_40px_-5px_rgba(16,185,129,0.5)]">
                                    <svg
                                        width="32"
                                        height="32"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="3"
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
                                <h2 className="text-2xl font-bold">Successfully Verified</h2>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-zinc-700">
                        FitssAI Secure Login
                    </p>
                </div>
            </div>
        </div>
    );
}
