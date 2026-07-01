"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Award,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  FileCheck,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type FrameworkId = "SOC2" | "GDPR" | "HIPAA";

interface ControlScore {
  id: string;
  name: string;
  description: string;
  weight: number;
  score: number;
  status: "compliant" | "partial" | "non_compliant";
  evidence: string[];
  gaps: string[];
}

interface FrameworkScore {
  framework: FrameworkId;
  score: number;
  readiness_level: string;
  controls: ControlScore[];
  metrics: {
    evidence_count: number;
    audit_event_count: number;
    framework_audit_event_count: number;
    audit_hash_count: number;
    redaction_count: number;
    active_policy_count: number;
    active_gateway_count: number;
    pending_approvals: number;
    open_findings: number;
    critical_findings: number;
    high_findings: number;
    resolved_findings: number;
  };
  generated_at: string;
}

interface ComplianceScoreState {
  overall_score: number;
  readiness_level: string;
  frameworks: FrameworkScore[];
  generated_at: string;
}

interface ScoreHistoryItem {
  framework: FrameworkId;
  snapshot_date: string;
  overall_score: number;
  readiness_level: string;
  evidence_count: number;
  audit_event_count: number;
  open_findings: number;
  critical_findings: number;
  generated_at: string;
}

const frameworkMeta: Record<FrameworkId, { name: string; desc: string; accent: string }> = {
  SOC2: {
    name: "SOC 2 Type II",
    desc: "Security, availability, confidentiality, monitoring, and remediation controls.",
    accent: "text-emerald-300",
  },
  GDPR: {
    name: "GDPR",
    desc: "Privacy-by-design, processing records, security controls, and risk evidence.",
    accent: "text-sky-300",
  },
  HIPAA: {
    name: "HIPAA Security Rule",
    desc: "Access, audit, integrity, and transmission safeguards for PHI-like workflows.",
    accent: "text-amber-200",
  },
};

const statusClass = (status: ControlScore["status"]) => {
  if (status === "compliant") return "bg-emerald-500/10 border-emerald-500/20 text-emerald-300";
  if (status === "partial") return "bg-amber-500/10 border-amber-500/20 text-amber-200";
  return "bg-red-500/10 border-red-500/20 text-red-300";
};

const readinessLabel = (value: string) => value.replaceAll("_", " ").toUpperCase();

export default function FrameworksPage() {
  const [scores, setScores] = useState<ComplianceScoreState | null>(null);
  const [history, setHistory] = useState<ScoreHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFramework, setActiveFramework] = useState<FrameworkId>("SOC2");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scoreRes = await fetch("/api/compliance-scores");
      if (scoreRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!scoreRes.ok) throw new Error("Failed to load framework scores");
      setScores(await scoreRes.json());
      const historyRes = await fetch(`/api/compliance-scores/history?framework=${activeFramework}&days=30`);
      if (historyRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setHistory(historyData.items || []);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load compliance scoring data";
      console.warn("Frameworks fetchScores failed:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeFramework]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchScores();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchScores]);

  const activeScore = useMemo(
    () => scores?.frameworks.find((item) => item.framework === activeFramework) || null,
    [activeFramework, scores],
  );

  const handleSignedExport = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      const res = await fetch("/api/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framework: activeFramework }),
      });
      const artifact = await res.json();
      if (!res.ok) throw new Error(artifact.error || "Signed export failed");
      const dataStr = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(artifact, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `authclaw_${activeFramework.toLowerCase()}_signed_audit_export_${artifact.payload?.export_id || Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setExportMessage(`Signed ${artifact.payload?.record_count ?? 0} ${activeFramework} audit records.`);
    } catch (err: unknown) {
      setExportMessage(err instanceof Error ? err.message : "Signed export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Compliance Frameworks
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Live readiness scores from evidence, findings, audit-chain events, redactions, policies, and approvals.
          </p>
        </div>

        <button
          onClick={fetchScores}
          className="self-start sm:self-center p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          title="Refresh framework statistics"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-center gap-3">
          <AlertCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(Object.keys(frameworkMeta) as FrameworkId[]).map((framework) => {
          const score = scores?.frameworks.find((item) => item.framework === framework);
          const active = activeFramework === framework;
          return (
            <button
              key={framework}
              onClick={() => setActiveFramework(framework)}
              className={`text-left relative overflow-hidden rounded-2xl border p-6 shadow-xl transition group ${
                active ? "bg-indigo-950/15 border-indigo-500/50" : "bg-[#09090d] border-slate-800 hover:border-slate-700/80"
              }`}
            >
              <div className="flex justify-between items-start">
                <span className={`p-2 rounded-xl border ${
                  active ? "bg-indigo-900/30 border-indigo-500/40 text-indigo-300" : "bg-slate-850 border-slate-700/50 text-slate-400"
                }`}>
                  <Award className="w-5 h-5" />
                </span>

                <div className="text-right">
                  <span className={`text-2xl font-black ${frameworkMeta[framework].accent}`}>
                    {loading ? "-" : `${score?.score ?? 0}%`}
                  </span>
                  <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                    {score ? readinessLabel(score.readiness_level) : "NO DATA"}
                  </span>
                </div>
              </div>

              <h3 className="text-sm font-bold text-white mt-4 group-hover:text-indigo-300 transition">{frameworkMeta[framework].name}</h3>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">{frameworkMeta[framework].desc}</p>

              <div className="w-full bg-slate-800/60 h-1.5 rounded-full mt-4 overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${score?.score ?? 0}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl bg-[#09090d] border border-slate-800 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 bg-[#0c0c12]/60 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4.5 h-4.5 text-indigo-400" />
                {activeFramework} Live Control Scores
              </h3>
              <span className="text-[10px] text-slate-500 font-bold">
                {activeScore?.controls.length || 0} controls
              </span>
            </div>

            {loading || !activeScore ? (
              <div className="p-8 flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {activeScore.controls.map((control) => (
                  <div key={control.id} className="p-6 space-y-3 hover:bg-slate-800/10 transition-colors">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold font-mono text-indigo-300 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10">
                          {control.id}
                        </span>
                        <h4 className="text-sm font-bold text-slate-200">{control.name}</h4>
                      </div>

                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${statusClass(control.status)}`}>
                        {control.status === "compliant" && <CheckCircle2 className="w-3 h-3" />}
                        {control.status === "partial" && <AlertCircle className="w-3 h-3" />}
                        {control.status === "non_compliant" && <XCircle className="w-3 h-3" />}
                        {control.status.replace("_", " ").toUpperCase()} · {control.score}%
                      </span>
                    </div>

                    <p className="text-slate-400 text-xs leading-relaxed">{control.description}</p>

                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${control.score}%` }} />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Evidence Signals</p>
                        <div className="mt-1.5 flex flex-col gap-1.5">
                          {(control.evidence.length ? control.evidence : ["No evidence signal yet"]).map((item) => (
                            <div key={item} className="flex items-center gap-2 text-xs text-slate-300">
                              <ChevronRight className="w-3 h-3 text-indigo-500 flex-shrink-0" />
                              <span className="font-mono bg-[#07070a] px-2 py-0.5 rounded border border-slate-850/60 flex items-center gap-1.5">
                                <Database className="w-3 h-3 text-indigo-400" />
                                {item}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gaps</p>
                        <div className="mt-1.5 flex flex-col gap-1.5">
                          {(control.gaps.length ? control.gaps : ["No active gap"]).map((item) => (
                            <div key={item} className="flex items-center gap-2 text-xs text-slate-400">
                              <ChevronRight className="w-3 h-3 text-amber-400 flex-shrink-0" />
                              <span className="font-mono bg-[#07070a] px-2 py-0.5 rounded border border-slate-850/60">
                                {item}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-5 shadow-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-indigo-400" />
              Live Score Inputs
            </h3>
            <div className="space-y-3 text-xs">
              {[
                ["Evidence Records", activeScore?.metrics.evidence_count],
                ["Audit Events", activeScore?.metrics.audit_event_count],
                ["Hash-Chained Events", activeScore?.metrics.audit_hash_count],
                ["Redaction Records", activeScore?.metrics.redaction_count],
                ["Open Findings", activeScore?.metrics.open_findings],
                ["Critical Findings", activeScore?.metrics.critical_findings],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1.5 border-b border-slate-800/60 last:border-b-0">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-bold text-slate-200 font-mono">{loading ? "-" : value ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-5 shadow-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">30-Day Score History</h3>
            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-xs text-slate-500">No score snapshots yet.</div>
              ) : (
                history.map((item) => (
                  <div key={`${item.framework}-${item.snapshot_date}`} className="rounded-lg border border-slate-800 bg-[#07070a] p-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">{item.snapshot_date}</span>
                      <span className="font-bold text-white">{item.overall_score}%</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${item.overall_score}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-5 shadow-xl space-y-4 relative overflow-hidden">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Auditor Export</h3>
            <p className="text-xs text-slate-500 leading-normal">
              Export a signed audit artifact filtered to the selected framework. Verification is available in Audit Explorer.
            </p>

            <button
              onClick={handleSignedExport}
              disabled={exporting || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg transition active:scale-[0.98] disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {exporting ? "Signing Export..." : `Export ${activeFramework} Audit`}
            </button>

            {exportMessage && (
              <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 text-[10px] leading-relaxed">
                {exportMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
