"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clipboard,
  KeyRound,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

interface SignupResponse {
  signup_id: string;
  email: string;
  tenant_name: string;
  expires_at: string;
  delivery: string;
  next_resend_at: string;
  dev_otp?: string;
}

interface VerifyResponse {
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  email: string;
  role: string;
  api_key: string;
  gateway_url: string;
  provider: string;
  model: string;
  powershell_snippet: string;
  curl_snippet: string;
}

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const payload = data as { detail?: unknown; message?: unknown; error?: unknown };
  const candidate = payload.detail ?? payload.message ?? payload.error;
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate)) {
    return candidate
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return fallback;
}

function SignupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("invite");
  const isInviteMode = Boolean(inviteId);
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [signup, setSignup] = useState<SignupResponse | null>(null);
  const [verified, setVerified] = useState<VerifyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const step = useMemo(() => {
    if (verified) return 3;
    if (isInviteMode) return 2;
    if (signup) return 2;
    return 1;
  }, [isInviteMode, signup, verified]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const resendSecondsRemaining = useMemo(() => {
    if (!signup?.next_resend_at) return 0;
    return Math.max(0, Math.ceil((new Date(signup.next_resend_at).getTime() - now) / 1000));
  }, [now, signup?.next_resend_at]);

  const requestOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      window.sessionStorage.removeItem("authclaw_onboarding_result");
      const response = await fetch("/api/onboarding/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tenant_name: tenantName }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(apiErrorMessage(data, "Could not start signup"));
      }
      setSignup(data);
      if (data.dev_otp) {
        setOtp(data.dev_otp);
      } else {
        setOtp("");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start signup");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    const signupId = signup?.signup_id || inviteId;
    if (!signupId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signup_id: signupId, otp }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(apiErrorMessage(data, "Could not verify code"));
      }
      setVerified(data);
      if (isInviteMode) {
        window.sessionStorage.removeItem("authclaw_onboarding_result");
        router.push("/overview");
      } else {
        window.sessionStorage.setItem("authclaw_onboarding_result", JSON.stringify(data));
        router.push("/connect?onboarding=1");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not verify code");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!signup) return;
    setResending(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signup_id: signup.signup_id }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(apiErrorMessage(data, "Could not resend code"));
      }
      setSignup((current) => current ? { ...current, ...data } : current);
      if (data.dev_otp) {
        setOtp(data.dev_otp);
      } else {
        setOtp("");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    } finally {
      setResending(false);
    }
  };

  const copyText = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <main className="min-h-screen bg-[#07070a] text-slate-100 font-sans">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-5 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">AuthClaw Lite</h1>
              <p className="text-xs text-slate-500">Create a protected AI gateway tenant</p>
            </div>
          </div>
          <Link href="/login" className="text-xs font-semibold text-slate-400 hover:text-slate-200">
            Sign in
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border border-slate-800 bg-[#0e0e15] p-5">
            {[
              ["Email OTP", isInviteMode ? "Verify tenant invite" : "Verify account ownership"],
              ["Tenant Setup", isInviteMode ? "Join existing tenant" : "Create tenant, route, key, policy"],
              ["Connect Provider", isInviteMode ? "Open tenant console" : "Save upstream Gemini/OpenAI key"],
            ].map(([title, subtitle], index) => {
              const active = step === index + 1;
              const complete = step > index + 1;
              return (
                <div key={title} className="flex gap-3 pb-5 last:pb-0">
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                      complete
                        ? "border-emerald-400 bg-emerald-400 text-slate-950"
                        : active
                          ? "border-indigo-400 bg-indigo-500 text-white"
                          : "border-slate-700 text-slate-500"
                    }`}
                  >
                    {complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${active ? "text-white" : "text-slate-300"}`}>{title}</p>
                    <p className="text-xs text-slate-500">{subtitle}</p>
                  </div>
                </div>
              );
            })}
          </aside>

          <section className="rounded-lg border border-slate-800 bg-[#0e0e15] p-6 shadow-2xl">
            {error && (
              <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
                <ShieldAlert className="h-4 w-4 text-red-300" />
                {error}
              </div>
            )}

            {!signup && !isInviteMode && (
              <form onSubmit={requestOtp} className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-white">Create Tenant</h2>
                  <p className="mt-1 text-sm text-slate-500">Start with email verification, then AuthClaw creates your tenant gateway.</p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">Work Email</span>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-[#07070a] py-2.5 pl-10 pr-4 text-sm text-slate-100 outline-none focus:border-indigo-500"
                      placeholder="you@company.com"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">Tenant Name</span>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      required
                      value={tenantName}
                      onChange={(event) => setTenantName(event.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-[#07070a] py-2.5 pl-10 pr-4 text-sm text-slate-100 outline-none focus:border-indigo-500"
                      placeholder="Acme Support"
                    />
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {loading ? "Sending code..." : "Send Verification Code"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            )}

            {(signup || isInviteMode) && !verified && (
              <form onSubmit={verifyOtp} className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-white">{isInviteMode ? "Verify Tenant Invite" : "Verify Email"}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {isInviteMode ? "Enter the 6-digit code sent to your email." : `Enter the 6-digit code sent to ${signup?.email}.`}
                  </p>
                </div>

                {signup?.dev_otp && (
                  <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
                    Demo OTP: <span className="font-mono font-bold">{signup.dev_otp}</span>
                  </div>
                )}

                {!signup?.dev_otp && (
                  <div className="rounded-lg border border-slate-800 bg-[#07070a] p-3 text-xs text-slate-400">
                    {isInviteMode
                      ? "Check your inbox and spam folder for the tenant invite code."
                      : `Code sent by ${signup?.delivery === "smtp" ? "email" : signup?.delivery}. Check your inbox and spam folder.`}
                  </div>
                )}

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">Verification Code</span>
                  <input
                    inputMode="numeric"
                    required
                    minLength={6}
                    maxLength={6}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full rounded-lg border border-slate-800 bg-[#07070a] px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-slate-100 outline-none focus:border-indigo-500"
                    placeholder="000000"
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {loading ? (isInviteMode ? "Joining tenant..." : "Creating tenant...") : (isInviteMode ? "Verify and Join Tenant" : "Verify and Create Tenant")}
                  <ShieldCheck className="h-4 w-4" />
                </button>

                {signup && (
                <div className="flex flex-col gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">
                    Code expires {new Date(signup.expires_at).toLocaleTimeString()}.
                  </p>
                  <button
                    type="button"
                    onClick={() => void resendOtp()}
                    disabled={loading || resending || resendSecondsRemaining > 0}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                  >
                    {resending
                      ? "Resending..."
                      : resendSecondsRemaining > 0
                        ? `Resend in ${resendSecondsRemaining}s`
                        : "Resend Code"}
                  </button>
                </div>
                )}
              </form>
            )}

            {verified && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-white">Tenant Ready</h2>
                  <p className="mt-1 text-sm text-slate-500">Your gateway key, starter policy, and default Gemini route are ready.</p>
                </div>

                <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                  Signed in as {verified.email} for {verified.tenant_name}.
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">AuthClaw Gateway Key</span>
                    <button
                      type="button"
                      onClick={() => copyText("key", verified.api_key)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                    >
                      <Clipboard className="h-3.5 w-3.5" />
                      {copied === "key" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-[#07070a] p-3 text-xs text-slate-200">
                    {verified.api_key}
                  </pre>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">PowerShell Test Request</span>
                    <button
                      type="button"
                      onClick={() => copyText("powershell", verified.powershell_snippet)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                    >
                      <Clipboard className="h-3.5 w-3.5" />
                      {copied === "powershell" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-slate-800 bg-[#07070a] p-3 text-xs text-slate-200">
                    {verified.powershell_snippet}
                  </pre>
                </div>

                <button
                  type="button"
                  onClick={() => router.push("/connect")}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Continue to Provider Key Vault
                  <KeyRound className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07070a] text-slate-100" />}>
      <SignupPageContent />
    </Suspense>
  );
}
