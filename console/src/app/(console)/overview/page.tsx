"use client";

import React, { useEffect, useState } from "react";
import { 
  ShieldCheck, 
  Activity, 
  EyeOff, 
  Clock, 
  Award, 
  ArrowUpRight, 
  RefreshCw,
  Building,
  CheckCircle2,
  XCircle
} from "lucide-react";
import Link from "next/link";

interface DashboardMetrics {
  openApprovals: number;
  redactions24h: number;
  totalRequests: number;
  requestsPerSec: number | null;
  p99LatencyMs: number | null;
}

export default function OverviewPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingActive, setPollingActive] = useState(true);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load metrics");
      const data = await res.json();
      setMetrics(data);
      setError(null);
    } catch (err: any) {
      console.warn("Overview fetch metrics failed:", err.message);
      setError(err.message || "Could not retrieve real-time metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    if (!pollingActive) return;
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [pollingActive]);

  const complianceReadiness = [
    { name: "SOC 2 Type II", score: 85, color: "from-emerald-500 to-teal-500", desc: "Trust Services Criteria - Security & Confidentiality" },
    { name: "GDPR", score: 78, color: "from-blue-500 to-indigo-500", desc: "Data Protection Safeguards & Consent Mechanisms" },
    { name: "HIPAA Safeguards", score: 92, color: "from-purple-500 to-violet-500", desc: "Administrative, Physical & Technical Safeguards" }
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Platform Overview
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time monitoring of AI governance, data privacy compliance, and proxy telemetry.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchMetrics}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            System Live
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Total Requests Card */}
        <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl hover:border-indigo-500/30 transition-all duration-300 group">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-indigo-500/5 blur-[40px] pointer-events-none" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Traffic Logged</p>
              <h3 className="text-2xl font-bold text-white mt-2">
                {loading ? "..." : metrics?.totalRequests ?? 0}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="text-slate-400">Total API calls intercepted</span>
            <Link href="/audit" className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 font-medium transition">
              Logs <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* PII Redactions Card */}
        <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl hover:border-emerald-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-emerald-500/5 blur-[40px] pointer-events-none" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">PII Redactions</p>
              <h3 className="text-2xl font-bold text-white mt-2">
                {loading ? "..." : metrics?.redactions24h ?? 0}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <EyeOff className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="text-slate-400">Masked or hashed (last 24h)</span>
            <span className="text-emerald-400 font-semibold">Active Engine</span>
          </div>
        </div>

        {/* Requests Per Second Card */}
        <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl hover:border-sky-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-sky-500/5 blur-[40px] pointer-events-none" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Throughput</p>
              <h3 className="text-2xl font-bold text-white mt-2">
                {loading ? (
                  "..."
                ) : metrics?.requestsPerSec !== null && metrics?.requestsPerSec !== undefined ? (
                  `${metrics.requestsPerSec} req/s`
                ) : (
                  <span className="text-sm font-medium text-slate-500">No data available yet</span>
                )}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <RefreshCw className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <span>Average request frequency</span>
            <span>Real-time</span>
          </div>
        </div>

        {/* P99 Latency Card */}
        <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl hover:border-purple-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-purple-500/5 blur-[40px] pointer-events-none" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">P99 Gateway Latency</p>
              <h3 className="text-2xl font-bold text-white mt-2">
                {loading ? (
                  "..."
                ) : metrics?.p99LatencyMs !== null && metrics?.p99LatencyMs !== undefined ? (
                  `${metrics.p99LatencyMs} ms`
                ) : (
                  <span className="text-sm font-medium text-slate-500">No data available yet</span>
                )}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <span>99th percentile request overhead</span>
            <span>Proxy latency</span>
          </div>
        </div>

      </div>

      {/* Main Grid: Compliance Readiness + Approvals Quick Look */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Compliance Readiness Column (Span 2) */}
        <div className="lg:col-span-2 rounded-2xl bg-[#09090d] border border-slate-800/60 p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-400" />
              Continuous Compliance Readiness
            </h3>
            <p className="text-slate-400 text-xs mt-1">
              Automated audit evaluation mapping control configurations to regulatory compliance safeguards.
            </p>
          </div>

          <div className="space-y-6 mt-6">
            {complianceReadiness.map((framework) => (
              <div key={framework.name} className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-300">{framework.name}</span>
                  <span className="font-bold text-white">{framework.score}% score</span>
                </div>
                <div className="h-2 w-full bg-slate-800/80 rounded-full overflow-hidden">
                  <div 
                    className={`h-full bg-gradient-to-r ${framework.color} rounded-full transition-all duration-1000`} 
                    style={{ width: `${framework.score}%` }} 
                  />
                </div>
                <p className="text-[10px] text-slate-500">{framework.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/40 flex justify-end">
            <Link href="/frameworks" className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition">
              Explore evidence control rooms <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Open Approvals Quick Look Card */}
        <div className="rounded-2xl bg-[#09090d]/80 border border-slate-800/60 p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Approvals Status
            </h3>
            <p className="text-slate-400 text-xs mt-1">
              Actions needing human authorization before execution.
            </p>
          </div>

          <div className="my-6 flex flex-col items-center justify-center text-center py-4">
            {loading ? (
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
            ) : metrics?.openApprovals && metrics.openApprovals > 0 ? (
              <>
                <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-2xl font-black text-amber-400 mb-3 animate-pulse">
                  {metrics.openApprovals}
                </div>
                <h4 className="text-sm font-semibold text-slate-200">Pending Authorization</h4>
                <p className="text-[11px] text-slate-500 max-w-[200px] mt-1">
                  Compliance Agent has generated remediation fixes requiring admin approval.
                </p>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
                <h4 className="text-sm font-semibold text-slate-200">All Clear</h4>
                <p className="text-[11px] text-slate-500 max-w-[200px] mt-1">
                  No pending workflow tasks awaiting human verification.
                </p>
              </>
            )}
          </div>

          <Link 
            href="/agent"
            className="w-full text-center py-2.5 rounded-lg bg-slate-850 hover:bg-slate-800 text-xs font-semibold text-slate-200 border border-slate-800 transition"
          >
            Open Compliance Agent
          </Link>
        </div>

      </div>
    </div>
  );
}
