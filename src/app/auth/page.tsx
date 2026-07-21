"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(true);
  const [step, setStep] = useState<"form" | "otp">("form");
  
  // Form values
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  
  // Status feedback
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (isSignUp && (!name.trim() || !email.trim() || !password.trim())) {
      setError("Please fill in all fields.");
      return;
    } else if (!isSignUp && !email.trim()) {
      setError("Please enter your email.");
      return;
    }

    setLoading(true);
    
    setLoading(true);
    
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");

      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }

  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!otp || otp.length !== 6) {
      setError("Please enter a valid 6-digit code.");
      return;
    }

    setLoading(true);
    
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otp }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");

      // Save some local state if needed by the UI, but session is handled by secure cookies
      localStorage.setItem("gs_user", JSON.stringify({
        name: isSignUp ? name : email.split("@")[0],
        email: email,
        isAuthenticated: true
      }));
      
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-staggered-blocks text-slate-800 flex flex-col justify-center items-center px-4 sm:px-6 relative overflow-hidden font-sans">
      
      {/* Brand Header */}
      <div className="mb-8 text-center z-10 flex flex-col items-center gap-4">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-12 h-12 rounded-2xl bg-white flex items-center justify-center p-1.5 shadow-md border border-slate-200/80 group-hover:scale-105 transition-transform">
            <Image
              src="/logo.png"
              alt="GrowthSaarthi Logo"
              width={40}
              height={40}
              className="object-contain"
              priority
            />
          </div>
          <div className="text-left">
            <div className="flex items-center">
              <span className="font-extrabold text-2xl tracking-tight text-slate-900">Growth</span>
              <span className="font-extrabold text-2xl tracking-tight text-[#E79E24]">Saarthi</span>
            </div>
            <span className="text-[9px] uppercase tracking-widest text-[#199874] font-extrabold block -mt-1">
              Your AI Chief of Staff
            </span>
          </div>
        </Link>
      </div>

      {/* Authentication Card */}
      <div className="w-full max-w-md bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-xl z-10 relative">
        {step === "form" ? (
          <>
            {/* Header Tabs */}
            <div className="grid grid-cols-2 bg-slate-50 border border-slate-100 rounded-2xl p-1 mb-8">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setError(null);
                }}
                className={`py-3 text-xs sm:text-sm font-extrabold rounded-xl transition-all cursor-pointer ${
                  isSignUp 
                    ? "bg-[#199874] text-white shadow" 
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Sign Up
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setError(null);
                }}
                className={`py-3 text-xs sm:text-sm font-extrabold rounded-xl transition-all cursor-pointer ${
                  !isSignUp 
                    ? "bg-[#199874] text-white shadow" 
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Sign In
              </button>
            </div>

            <div className="mb-6">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                {isSignUp ? "Create your account" : "Welcome back"}
              </h2>
              <p className="text-xs text-slate-500 mt-1.5 font-semibold">
                {isSignUp 
                  ? "Launch a 30-day autonomous growth plan for your brand." 
                  : "Sign in with your email address to access your dashboard."
                }
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-2xl text-xs text-red-700 font-bold mb-5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {isSignUp && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-slate-950 placeholder-slate-400 text-sm focus:outline-none focus:border-[#199874] focus:ring-1 focus:ring-[#199874] transition-all"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-slate-950 placeholder-slate-400 text-sm focus:outline-none focus:border-[#199874] focus:ring-1 focus:ring-[#199874] transition-all"
                />
              </div>

              {isSignUp && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-slate-950 placeholder-slate-400 text-sm focus:outline-none focus:border-[#199874] focus:ring-1 focus:ring-[#199874] transition-all"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-6 bg-[#199874] hover:bg-[#168868] text-white font-extrabold py-3.5 px-4 rounded-2xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Sending Passcode...</span>
                  </>
                ) : (
                  <span>{isSignUp ? "Register & Request OTP" : "Request OTP Code"}</span>
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            {/* OTP Screen */}
            <div className="mb-6">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">Verify your identity</h2>
              <p className="text-xs text-slate-500 mt-1.5 font-semibold">
                We've sent a 6-digit passcode via email to <strong className="text-slate-800">{email}</strong>. Please enter it below.
              </p>
            </div>

            {error && (

              <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-2xl text-xs text-red-700 font-bold mb-5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleOtpVerify} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-slate-600 uppercase tracking-wider text-center">Enter 6-Digit Passcode</label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="0 0 0 0 0 0"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-center text-xl font-bold tracking-[0.75em] text-slate-950 placeholder-slate-350 focus:outline-none focus:border-[#199874] focus:ring-1 focus:ring-[#199874] transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-6 bg-[#199874] hover:bg-[#168868] text-white font-extrabold py-3.5 px-4 rounded-2xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Verifying Code...</span>
                  </>
                ) : (
                  <span>Verify Passcode & Enter Dashboard</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("form");
                  setError(null);
                  setOtp("");
                }}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-900 transition-colors font-bold mt-2 hover:underline cursor-pointer"
              >
                &larr; Back to {isSignUp ? "Sign Up" : "Sign In"}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Footer Details */}
      <div className="mt-8 text-[11px] text-slate-400 font-bold z-10">
        Secured with standard end-to-end encryption.
      </div>
    </div>
  );
}
