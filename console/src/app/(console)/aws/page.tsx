"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Cloud,
  Database,
  Zap,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  BarChart3,
  Loader2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AWSStatus {
  aws_enabled: boolean;
  bedrock_enabled: boolean;
  s3_status: string;
  bedrock_status: string;
  region: string | null;
  bucket: string | null;
}

interface S3Document {
  id: string;
  bucket_name: string;
  object_key: string;
  file_name: string;
  file_size_bytes: number | null;
  content_type: string | null;
  last_modified: string | null;
  synced_at: string;
}

interface AWSUsage {
  tenant_id: string;
  daily_requests: number;
  max_daily_requests: number;
  daily_tokens: number;
  max_daily_tokens: number;
  daily_cost_estimate: number;
  max_daily_cost_usd: number;
  last_reset: string;
  requests_remaining: number;
  tokens_remaining: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Status Badge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
      </span>
    );
  }
  if (status === "disabled" || status === "not_configured") {
    return (
      <span className="flex items-center gap-1.5 text-slate-500 text-xs font-semibold">
        <AlertCircle className="w-3.5 h-3.5" /> {status === "disabled" ? "Disabled" : "Not Configured"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
      <XCircle className="w-3.5 h-3.5" /> Error
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Usage Progress Bar
// ─────────────────────────────────────────────────────────────────────────────

function UsageBar({ used, max, label, unit }: { used: number; max: number; label: string; unit: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400 mb-1.5">
        <span>{label}</span>
        <span className="font-mono">
          {used.toLocaleString()} / {max.toLocaleString()} {unit}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AWSConnectorPage() {
  const [status, setStatus] = useState<AWSStatus | null>(null);
  const [documents, setDocuments] = useState<S3Document[]>([]);
  const [usage, setUsage] = useState<AWSUsage | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/aws/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // Non-fatal — AWS may be disabled
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const res = await fetch("/api/aws/s3");
      if (res.ok) setDocuments(await res.json());
    } catch {/* non-fatal */} finally {
      setLoadingDocs(false);
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/aws/usage");
      if (res.ok) setUsage(await res.json());
    } catch {/* non-fatal */}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchDocuments();
    fetchUsage();
  }, [fetchStatus, fetchDocuments, fetchUsage]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/aws/s3", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`✓ Synced ${data.synced} new / updated objects from s3://${data.bucket}${data.prefix}`);
        fetchDocuments();
        fetchUsage();
      } else {
        setSyncResult(`✗ ${data.detail || "Sync failed"}`);
      }
    } catch (e: any) {
      setSyncResult(`✗ ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            AWS Connectors
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Phase 14 — S3 document ingestion and Amazon Bedrock provider integration.
          </p>
        </div>
        <button
          onClick={() => { fetchStatus(); fetchDocuments(); fetchUsage(); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Connection Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* S3 Status */}
        <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl hover:border-amber-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-amber-500/5 blur-[40px] pointer-events-none" />
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Database className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-white">Amazon S3</p>
          </div>
          {loadingStatus ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
          ) : (
            <>
              <StatusBadge status={status?.s3_status ?? "not_configured"} />
              {status?.bucket && (
                <p className="text-xs text-slate-500 mt-2 font-mono truncate">{status.bucket}</p>
              )}
              {status?.region && (
                <p className="text-xs text-slate-600 mt-1 font-mono">{status.region}</p>
              )}
            </>
          )}
          {!status?.aws_enabled && (
            <p className="text-xs text-slate-600 mt-3 italic">
              Set AWS_ENABLED=true in .env.local to enable.
            </p>
          )}
        </div>

        {/* Bedrock Status */}
        <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl hover:border-violet-500/30 transition-all duration-300">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-violet-500/5 blur-[40px] pointer-events-none" />
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <Zap className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-white">Amazon Bedrock</p>
          </div>
          {loadingStatus ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
          ) : (
            <StatusBadge status={status?.bedrock_status ?? "disabled"} />
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["anthropic.claude-3-haiku", "amazon.titan-text-express"].map((m) => (
              <span key={m} className="text-[10px] font-mono bg-slate-800/60 border border-slate-700/60 text-slate-400 rounded px-1.5 py-0.5">
                {m}
              </span>
            ))}
          </div>
          {!status?.bedrock_enabled && (
            <p className="text-xs text-slate-600 mt-3 italic">
              Set BEDROCK_ENABLED=true in .env.local to enable.
            </p>
          )}
        </div>
      </div>

      {/* Bedrock Usage Meter */}
      {usage && (
        <div className="rounded-2xl bg-[#09090d] border border-slate-800/80 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Bedrock Daily Usage</p>
              <p className="text-xs text-slate-500">
                Resets at midnight UTC · Last reset:{" "}
                {new Date(usage.last_reset).toLocaleString()}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-slate-500">Estimated Cost</p>
              <p className="text-base font-bold text-white font-mono">
                ${usage.daily_cost_estimate.toFixed(4)}
                <span className="text-slate-500 text-xs font-normal">
                  {" "}/ ${usage.max_daily_cost_usd.toFixed(2)} limit
                </span>
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <UsageBar
              used={usage.daily_requests}
              max={usage.max_daily_requests}
              label="Requests"
              unit="req"
            />
            <UsageBar
              used={usage.daily_tokens}
              max={usage.max_daily_tokens}
              label="Tokens"
              unit="tok"
            />
          </div>
        </div>
      )}

      {/* S3 Documents */}
      <div className="rounded-2xl bg-[#09090d] border border-slate-800/80 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">S3 Documents</p>
              <p className="text-xs text-slate-500">{documents.length} synced object{documents.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {syncResult && (
              <span className={`text-xs ${syncResult.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
                {syncResult}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || !status?.aws_enabled}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition"
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Sync from S3
            </button>
          </div>
        </div>

        {loadingDocs ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
          </div>
        ) : documents.length === 0 ? (
          <div className="p-10 text-center">
            <Cloud className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No documents synced yet.</p>
            <p className="text-slate-600 text-xs mt-1">
              Upload files to <code className="font-mono">s3://{status?.bucket ?? "your-bucket"}/tenant-&lt;id&gt;/</code> then click Sync.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/60">
                  <th className="px-6 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">File Name</th>
                  <th className="px-6 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Size</th>
                  <th className="px-6 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Type</th>
                  <th className="px-6 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Last Modified</th>
                  <th className="px-6 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Synced</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition">
                    <td className="px-6 py-3 font-mono text-slate-200 truncate max-w-xs">{doc.file_name}</td>
                    <td className="px-6 py-3 text-slate-400 font-mono">{formatBytes(doc.file_size_bytes)}</td>
                    <td className="px-6 py-3 text-slate-500 truncate max-w-[120px]">{doc.content_type ?? "—"}</td>
                    <td className="px-6 py-3 text-slate-500">
                      {doc.last_modified ? new Date(doc.last_modified).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {new Date(doc.synced_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
