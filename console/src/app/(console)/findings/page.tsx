"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  FileSearch,
  ShieldAlert,
  FileCheck,
  FileWarning,
  Link2,
  Clock,
  Filter,
  ExternalLink,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Info,
  DatabaseZap,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Finding {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  evidence_id: string | null;
  framework: string;
  finding_key: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  finding_type: string;
  risk_score: number;
  remediation_summary: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  evidence_created_at: string | null;
}

interface FindingListResponse {
  total: number;
  page: number;
  page_size: number;
  items: Finding[];
}

interface DashboardSummary {
  open_findings: number;
  critical_findings: number;
  resolved_findings: number;
  average_risk_score: number;
  severity_distribution: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRAMEWORK_OPTIONS = ["", "GDPR", "HIPAA", "SOC2"] as const;
const FINDING_TYPE_OPTIONS = [
  "",
  "PII_EXPOSURE",
  "POLICY_VIOLATION",
  "ACCESS_CONTROL",
  "DATA_RETENTION",
  "ENCRYPTION",
  "AUDIT_GAP",
  "AI_GOVERNANCE",
] as const;
const SEVERITY_OPTIONS = ["", "critical", "high", "medium", "low", "info"] as const;
const STATUS_OPTIONS = [
  "",
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "AWAITING_APPROVAL",
  "RESOLVED",
  "FALSE_POSITIVE",
  "ACCEPTED_RISK"
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityConfig(severity: string) {
  switch (severity) {
    case "critical":
      return { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-400" };
    case "high":
      return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", dot: "bg-orange-400" };
    case "medium":
      return { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/30", dot: "bg-yellow-400" };
    case "low":
      return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30", dot: "bg-blue-400" };
    default:
      return { bg: "bg-slate-500/15", text: "text-slate-400", border: "border-slate-500/30", dot: "bg-slate-400" };
  }
}

function statusConfig(status: string) {
  switch (status) {
    case "OPEN":
      return { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30" };
    case "ACKNOWLEDGED":
    case "IN_PROGRESS":
      return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" };
    case "AWAITING_APPROVAL":
      return { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/30" };
    case "RESOLVED":
    case "FALSE_POSITIVE":
    case "ACCEPTED_RISK":
      return { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" };
    default:
      return { bg: "bg-slate-500/15", text: "text-slate-400", border: "border-slate-500/30" };
  }
}

function formatType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function shortId(id: string) {
  return id.slice(0, 8) + "…";
}

// ---------------------------------------------------------------------------
// Filter select component
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-[#0d0d13] border border-slate-700/60 text-slate-300 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 cursor-pointer hover:border-slate-600 transition-colors"
      >
        <option value="">{label}</option>
        {options.slice(1).map((o) => (
          <option key={o} value={o}>
            {formatType(o)}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Drawer
// ---------------------------------------------------------------------------

function FindingDrawer({
  finding,
  onClose,
  onStatusChange,
}: {
  finding: Finding;
  onClose: () => void;
  onStatusChange: (findingId: string, newStatus: string) => void;
}) {
  const sev = severityConfig(finding.severity);
  const st = statusConfig(finding.status);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 h-full w-full max-w-xl bg-[#0a0a10] border-l border-slate-800 z-50 flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-[#09090d]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Finding Detail</p>
              <p className="text-sm font-mono text-slate-300">{shortId(finding.id)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white tracking-wide">{finding.title}</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${sev.bg} ${sev.text} ${sev.border}`}>
                  {finding.severity.toUpperCase()}
                </span>
                <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${st.bg} ${st.text} ${st.border}`}>
                  {formatType(finding.status)}
                </span>
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800/50 text-slate-300 border border-slate-700/50">
                  {finding.framework}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">Finding Information</h3>
            <div className="bg-[#0d0d13] border border-slate-800/60 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Finding Type</p>
                  <p className="text-sm text-slate-300 font-medium">{formatType(finding.finding_type)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Risk Score</p>
                  <p className="text-sm text-slate-300 font-mono">{(finding.risk_score * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Owner</p>
                  <p className="text-sm text-slate-300">
                    {finding.owner_user_id ? 
                      (finding.owner_user_id.includes('@') ? finding.owner_user_id : shortId(finding.owner_user_id)) 
                      : "Unassigned"}
                  </p>
                </div>
                <div className="col-span-2">
                  <div className="grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-lg border border-slate-800/50">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Evidence Created</p>
                      <p className="text-sm text-slate-300 font-mono">{finding.evidence_created_at ? formatDate(finding.evidence_created_at) : "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Finding Created</p>
                      <p className="text-sm text-slate-300 font-mono">{formatDate(finding.created_at)}</p>
                    </div>
                  </div>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 mb-1">Finding Key</p>
                  <p className="text-xs text-slate-400 font-mono break-all bg-black/40 p-2 rounded-md border border-slate-800">{finding.finding_key}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Description</p>
                <p className="text-sm text-slate-300 leading-relaxed bg-black/40 p-3 rounded-lg border border-slate-800">
                  {finding.description || "No description provided."}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">Traceability</h3>
            <div className="bg-[#0d0d13] border border-slate-800/60 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Workflow Reference</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-300 font-mono bg-black/40 px-2 py-1 rounded border border-slate-800">
                    {finding.workflow_id || "N/A"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Evidence Reference</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300 font-mono bg-black/40 px-2 py-1 rounded border border-slate-800">
                      {finding.evidence_id || "N/A"}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 mb-1">Related Evidence</p>
                  <p className="text-sm text-slate-300 font-medium">{finding.evidence_id ? "1 record" : "0 records"}</p>
                </div>
              </div>
              {finding.evidence_id && (
                <Link
                  href={`/evidence?evidence_id=${finding.evidence_id}&openDrawer=true`}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-sm font-medium rounded-lg border border-indigo-500/30 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Evidence
                </Link>
              )}
            </div>
          </div>

          {finding.remediation_summary && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Suggested Remediation</h3>
              <div className="bg-[#0d0d13] border border-slate-800/60 rounded-xl p-4">
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {finding.remediation_summary}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">Manage Status</h3>
            <div className="bg-[#0d0d13] border border-slate-800/60 rounded-xl p-4 flex flex-col gap-3">
              <label className="text-xs text-slate-500">Update Status</label>
              <select
                value={finding.status}
                onChange={(e) => onStatusChange(finding.id, e.target.value)}
                className="bg-black/40 border border-slate-700/60 text-slate-300 text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500/50"
              >
                {STATUS_OPTIONS.slice(1).map(s => (
                  <option key={s} value={s}>{formatType(s)}</option>
                ))}
              </select>
            </div>
          </div>

        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function FindingsDashboard() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [framework, setFramework] = useState("");
  const [findingType, setFindingType] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");

  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy?path=/v1/findings/summary/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard summary");
      const data = await res.json();
      setSummary(data);
    } catch (e: any) {
      console.error(e);
    }
  }, []);

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (framework) params.append("framework", framework);
      if (findingType) params.append("finding_type", findingType);
      if (severity) params.append("severity", severity);
      if (status) params.append("status", status);

      const res = await fetch(`/api/proxy?path=/v1/findings&${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data: FindingListResponse = await res.json();
      setFindings(data.items);
      setTotal(data.total);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, framework, findingType, severity, status]);

  useEffect(() => {
    fetchFindings();
    fetchSummary();
  }, [fetchFindings, fetchSummary]);

  const handleStatusChange = async (findingId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/proxy?path=/v1/findings/${findingId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const updated = await res.json();
      setFindings((prev) => prev.map((f) => (f.id === findingId ? updated : f)));
      if (selectedFinding?.id === findingId) {
        setSelectedFinding(updated);
      }
      fetchSummary();
    } catch (e: any) {
      console.error(e);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-indigo-400" />
            Findings Dashboard
          </h1>
          <p className="text-slate-400 mt-2 text-sm max-w-2xl">
            Operational compliance layer. Review and remediate actionable compliance issues derived from evidence.
          </p>
        </div>
        <button
          onClick={fetchFindings}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-[#0d0d13] border border-slate-700/60 hover:border-slate-500 rounded-lg text-sm text-slate-300 transition-colors shadow-sm self-start md:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#0a0a10] border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-10">
               <AlertTriangle className="w-16 h-16" />
             </div>
             <p className="text-sm text-slate-400 font-medium">Critical Findings</p>
             <p className="text-3xl font-bold text-red-400 mt-2">{summary.critical_findings}</p>
          </div>
          <div className="bg-[#0a0a10] border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-10">
               <ShieldAlert className="w-16 h-16" />
             </div>
             <p className="text-sm text-slate-400 font-medium">Open Findings</p>
             <p className="text-3xl font-bold text-indigo-400 mt-2">{summary.open_findings}</p>
          </div>
          <div className="bg-[#0a0a10] border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-10">
               <CheckCircle2 className="w-16 h-16" />
             </div>
             <p className="text-sm text-slate-400 font-medium">Resolved Findings</p>
             <p className="text-3xl font-bold text-emerald-400 mt-2">{summary.resolved_findings}</p>
          </div>
          <div className="bg-[#0a0a10] border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
             <div className="absolute top-0 right-0 p-4 opacity-10">
               <TrendingUp className="w-16 h-16" />
             </div>
             <p className="text-sm text-slate-400 font-medium">Average Risk</p>
             <p className="text-3xl font-bold text-yellow-400 mt-2">{(summary.average_risk_score * 100).toFixed(0)}%</p>
          </div>
        </div>
      )}

      {/* Severity Distribution Cards */}
      {summary?.severity_distribution && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#0d0d13] border border-red-500/30 rounded-xl p-4 shadow-sm flex items-center justify-between">
             <p className="text-sm text-red-400 font-medium">Critical</p>
             <p className="text-xl font-bold text-white">{summary.severity_distribution.critical || 0}</p>
          </div>
          <div className="bg-[#0d0d13] border border-orange-500/30 rounded-xl p-4 shadow-sm flex items-center justify-between">
             <p className="text-sm text-orange-400 font-medium">High</p>
             <p className="text-xl font-bold text-white">{summary.severity_distribution.high || 0}</p>
          </div>
          <div className="bg-[#0d0d13] border border-yellow-500/30 rounded-xl p-4 shadow-sm flex items-center justify-between">
             <p className="text-sm text-yellow-400 font-medium">Medium</p>
             <p className="text-xl font-bold text-white">{summary.severity_distribution.medium || 0}</p>
          </div>
          <div className="bg-[#0d0d13] border border-blue-500/30 rounded-xl p-4 shadow-sm flex items-center justify-between">
             <p className="text-sm text-blue-400 font-medium">Low</p>
             <p className="text-xl font-bold text-white">{summary.severity_distribution.low || 0}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-[#0a0a10] border border-slate-800 rounded-xl p-4 flex flex-wrap gap-4 items-center shadow-sm">
        <div className="flex items-center gap-2 text-slate-400 mr-2">
          <Filter className="w-4 h-4" />
          <span className="text-sm font-medium">Filters:</span>
        </div>
        <FilterSelect label="All Frameworks" value={framework} options={FRAMEWORK_OPTIONS} onChange={(v) => { setFramework(v); setPage(1); }} />
        <FilterSelect label="All Types" value={findingType} options={FINDING_TYPE_OPTIONS} onChange={(v) => { setFindingType(v); setPage(1); }} />
        <FilterSelect label="All Severities" value={severity} options={SEVERITY_OPTIONS} onChange={(v) => { setSeverity(v); setPage(1); }} />
        <FilterSelect label="All Statuses" value={status} options={STATUS_OPTIONS} onChange={(v) => { setStatus(v); setPage(1); }} />

        {(framework || findingType || severity || status) && (
          <button
            onClick={() => {
              setFramework("");
              setFindingType("");
              setSeverity("");
              setStatus("");
              setPage(1);
            }}
            className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 ml-auto"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#0a0a10] border border-slate-800 rounded-xl shadow-xl overflow-hidden flex flex-col min-h-[400px]">
        {error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <AlertCircle className="w-10 h-10 text-red-500/50 mb-4" />
            <p className="text-red-400 font-medium">Failed to load findings</p>
            <p className="text-slate-500 text-sm mt-1">{error}</p>
          </div>
        ) : loading && findings.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <RefreshCw className="w-8 h-8 text-indigo-500/50 animate-spin mb-4" />
            <p className="text-slate-400 text-sm font-medium animate-pulse">Loading findings...</p>
          </div>
        ) : findings.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4 border border-slate-700/50">
              <Search className="w-8 h-8 text-slate-500" />
            </div>
            <p className="text-slate-300 font-medium text-lg">No findings found</p>
            <p className="text-slate-500 text-sm mt-2 max-w-sm">
              Adjust your filters or trigger a compliance workflow to generate findings.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#0d0d13]">
                    <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Severity</th>
                    <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Title</th>
                    <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Framework</th>
                    <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Owner</th>
                    <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {findings.map((f) => {
                    const sev = severityConfig(f.severity);
                    const st = statusConfig(f.status);

                    return (
                      <tr
                        key={f.id}
                        onClick={() => setSelectedFinding(f)}
                        className="hover:bg-slate-800/30 transition-colors cursor-pointer group"
                      >
                        <td className="py-4 px-6">
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${sev.bg} ${sev.text} ${sev.border}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                            {f.severity.toUpperCase()}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-slate-200 font-medium group-hover:text-indigo-300 transition-colors line-clamp-1">
                            {f.title}
                          </p>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                            {f.framework}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${st.bg} ${st.text} ${st.border}`}>
                            {formatType(f.status)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-sm text-slate-400">
                          {f.owner_user_id ? shortId(f.owner_user_id) : "Unassigned"}
                        </td>
                        <td className="py-4 px-6 text-sm text-slate-400 font-mono">
                          {formatDate(f.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-auto px-6 py-4 border-t border-slate-800 bg-[#0d0d13] flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Showing <span className="font-medium text-slate-300">{findings.length}</span> of <span className="font-medium text-slate-300">{total}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-slate-400 font-medium min-w-[3rem] text-center">
                  {page} / {totalPages || 1}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedFinding && (
        <FindingDrawer
          finding={selectedFinding}
          onClose={() => setSelectedFinding(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
