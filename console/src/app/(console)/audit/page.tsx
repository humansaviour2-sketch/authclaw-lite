"use client";

import React, { useState, useEffect } from "react";
import { 
  ScrollText, 
  Search, 
  Download, 
  CheckCircle2, 
  XCircle, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw,
  SlidersHorizontal,
  Calendar,
  AlertTriangle,
  FileDown,
  X,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";

interface AuditRecord {
  record_id: string;
  timestamp: string;
  actor_id: string;
  actor_type: string;
  action: string;
  provider?: string;
  model?: string;
  reason?: string;
  response_status?: number;
  duration_ms?: number;
  frameworks_affected?: string[];
  chain_valid?: boolean;
  request_id?: string;
  prior_hash?: string;
  integrity_hash?: string;
  execution_trace?: any;
  [key: string]: any;
}

export default function AuditPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [auditSource, setAuditSource] = useState("");
  const [integrityCheckedByBackend, setIntegrityCheckedByBackend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inspector Panel State
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    await copyTextToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [integrityCheck, setIntegrityCheck] = useState(true);

  // Pagination
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        integrity_check: String(integrityCheck),
      });

      if (actionFilter) queryParams.set("action", actionFilter);
      // Wait, actorFilter and date filters can be filtered client-side or we can forward if backend supported, 
      // let's do a combination: forward action and filter actor/dates client-side since FastAPI /v1/audit-logs only has action filter natively.
      const res = await fetch(`/api/audit?${queryParams.toString()}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      const data = await res.json();
      
      setRecords(data.records || []);
      setTotal(data.total || (data.records ? data.records.length : 0));
      setAuditSource(data.source || "");
      setIntegrityCheckedByBackend(Boolean(data.integrity_checked));
    } catch (err: any) {
      console.warn("Audit fetchLogs failed:", err.message);
      setError(err.message || "Could not retrieve audit logs from ClickHouse/Postgres");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [offset, limit, actionFilter, integrityCheck]);

  // Client-side additional filtering for Actor ID & Date Range
  const filteredRecords = records.filter((rec) => {
    if (actorFilter && !rec.actor_id.toLowerCase().includes(actorFilter.toLowerCase())) {
      return false;
    }
    if (dateStart) {
      const start = new Date(dateStart).getTime();
      const timestamp = new Date(rec.timestamp).getTime();
      if (timestamp < start) return false;
    }
    if (dateEnd) {
      const end = new Date(dateEnd).getTime() + 86400000; // include full day
      const timestamp = new Date(rec.timestamp).getTime();
      if (timestamp > end) return false;
    }
    return true;
  });

  const exportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredRecords, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `authclaw_audit_export_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportCSV = () => {
    const headers = ["Timestamp", "Record ID", "Actor ID", "Action", "Provider", "Model", "Response Status", "Duration (ms)", "Frameworks", "Integrity Status"];
    const rows = filteredRecords.map((r) => [
      r.timestamp,
      r.record_id,
      r.actor_id,
      r.action,
      r.provider,
      r.model,
      r.response_status,
      r.duration_ms,
      r.frameworks_affected ? r.frameworks_affected.join(";") : "",
      r.chain_valid ? "Verified" : "Unverified"
    ]);

    const csvContent = [headers.join(","), ...rows.map((e) => e.map(val => `"${val}"`).join(","))].join("\n");
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `authclaw_audit_export_${Date.now()}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handlePrevPage = () => {
    if (offset >= limit) {
      setOffset(offset - limit);
    }
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Audit Explorer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Immutably log every proxy interaction with SHA-256 integrity-chain verification.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchLogs}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-350 border border-slate-700 transition"
            title="Refresh logs"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          <button
            onClick={exportJSON}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <FileDown className="w-4.5 h-4.5 text-indigo-400" />
            Export JSON
          </button>

          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <Download className="w-4.5 h-4.5 text-emerald-400" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-5 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-slate-300 text-xs font-bold uppercase tracking-wider">
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          Search & Query Filters
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
              className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-850 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
            >
              <option value="">All Actions</option>
              <option value="allow">ALLOW</option>
              <option value="test_request">TEST REQUEST</option>
              <option value="redact">REDACT</option>
              <option value="block">BLOCK</option>
              <option value="approval_allow">APPROVAL ALLOW</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Actor ID</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-600">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                placeholder="Search Actor UUID..."
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#07070a] border border-slate-850 text-slate-200 text-xs placeholder-slate-700 focus:outline-none focus:border-indigo-500/80 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Date Start</label>
            <div className="relative">
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-850 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Date End</label>
            <div className="relative">
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-850 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-850/60 text-xs">
          <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={integrityCheck}
              onChange={(e) => setIntegrityCheck(e.target.checked)}
              className="rounded bg-slate-900 border-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0"
            />
            Perform Cryptographic Chain Integrity Verification
          </label>
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-2xl bg-[#09090d] border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[300px]">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mb-2" />
              <p className="text-xs text-slate-500">Retrieving audit ledger...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center text-red-400 flex flex-col items-center justify-center min-h-[300px]">
              <AlertTriangle className="w-10 h-10 mb-3" />
              <h4 className="font-bold">Fetch Failed</h4>
              <p className="text-xs text-slate-500 mt-1">{error}</p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <ScrollText className="w-10 h-10 text-slate-650 mb-3" />
              <h4 className="text-sm font-semibold text-slate-350">No data available yet</h4>
              <p className="text-slate-500 text-xs mt-1">
                No logs matched the selected filters or no traffic has been intercepted.
              </p>
              {auditSource === "postgres" && (
                <p className="mt-2 text-[11px] text-slate-600">
                  Using Postgres fallback audit storage.
                </p>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-805 bg-[#07070a]/40 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Actor ID</th>
                  <th className="px-6 py-4">Action / Rule</th>
                  <th className="px-6 py-4">Provider / Model</th>
                  <th className="px-6 py-4">Integrity Badge</th>
                  <th className="px-6 py-4">Affected Frameworks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredRecords.map((log) => {
                  const isBlock = log.action.toLowerCase() === "block";
                  return (
                    <tr 
                      key={log.record_id} 
                      onClick={() => setSelectedRecord(log)}
                      className="hover:bg-slate-800/30 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4 font-mono text-slate-450">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-350 select-all" title={log.actor_id}>
                        {log.actor_id ? `${log.actor_id.slice(0, 8)}...` : "System"}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isBlock 
                            ? "bg-red-500/10 border border-red-500/20 text-red-400" 
                            : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                        }`}>
                          {log.action.toUpperCase()}
                        </span>
                        {log.reason && log.reason !== "None" && (
                          <div className="text-[10px] text-slate-500 mt-1 max-w-[200px] truncate" title={log.reason}>
                            {log.reason}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-300 capitalize">{log.provider}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">{log.model}</div>
                      </td>
                      <td className="px-6 py-4">
                        {integrityCheck && integrityCheckedByBackend ? (
                          log.chain_valid ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              ✓ Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400 animate-pulse">
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                              ⚠️ Tampered
                            </span>
                          )
                        ) : auditSource === "postgres" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-400">
                            <ScrollText className="w-3.5 h-3.5" />
                            Stored
                          </span>
                        ) : (
                          <span className="text-slate-600 text-[10px]">Skipped</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {log.frameworks_affected && log.frameworks_affected.length > 0 ? (
                            log.frameworks_affected.map((f) => (
                              <span key={f} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700/60 font-semibold">
                                {f}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Toolbar */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-[#0c0c12]/40 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing <span className="font-semibold text-slate-200">{filteredRecords.length}</span> entries
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={offset === 0 || loading}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-40 disabled:pointer-events-none transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-slate-300">
              Page {Math.floor(offset / limit) + 1}
            </span>
            <button
              onClick={handleNextPage}
              disabled={records.length < limit || loading}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-40 disabled:pointer-events-none transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Slide-out Event Inspector Panel */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" 
            onClick={() => setSelectedRecord(null)} 
          />
          
          {/* Panel Container */}
          <div className="relative w-full max-w-lg md:max-w-xl bg-[#09090d] border-l border-slate-800 shadow-2xl p-6 flex flex-col h-full overflow-y-auto text-xs text-slate-300">
            {/* Header */}
            <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <ScrollText className="w-4 h-4 text-indigo-400" />
                  Event Inspector
                </h3>
                <p className="text-[10px] text-slate-550 mt-0.5 font-medium">
                  Telemetry and cryptographic integrity validation.
                </p>
              </div>
              <button 
                onClick={() => setSelectedRecord(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-455 hover:text-white transition cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Cryptographic Badge */}
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0c0c12]/40 mb-6 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase text-slate-550 block tracking-wider mb-1">
                  CRYPTOGRAPHIC INTEGRITY STATUS
                </span>
                {integrityCheck && integrityCheckedByBackend ? (
                  selectedRecord.chain_valid ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 rounded-full">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Chain Valid & Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/25 px-2.5 py-0.5 rounded-full animate-pulse">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Verification Failed (Tampered)
                    </span>
                  )
                ) : auditSource === "postgres" ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 bg-sky-500/10 border border-sky-500/25 px-2.5 py-0.5 rounded-full">
                    <ScrollText className="w-3.5 h-3.5" />
                    Stored in Postgres Fallback
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-550 bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded-full">
                    Verification Skipped
                  </span>
                )}
              </div>
              <span className="text-[10px] font-bold text-slate-550 uppercase px-2 py-0.5 rounded bg-slate-900 border border-slate-850">
                Source: {selectedRecord.provider ? "LLM Proxy" : "System Audit"}
              </span>
            </div>

            {/* Telemetry and Details */}
            <div className="space-y-5">
              {/* Event Metadata */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                  Event Metadata
                </h4>
                <div className="grid grid-cols-2 gap-3.5 p-4 rounded-xl border border-slate-800 bg-[#07070a] text-[11px]">
                  <div>
                    <span className="text-slate-550 text-[9px] font-black uppercase">RECORD ID</span>
                    <div className="flex items-center gap-1 mt-0.5 font-mono text-[10px] text-slate-300">
                      <span>{selectedRecord.record_id}</span>
                      <button 
                        onClick={() => handleCopy(selectedRecord.record_id, 'record_id')}
                        className="p-0.5 text-slate-550 hover:text-white transition cursor-pointer"
                      >
                        {copiedField === 'record_id' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-550 text-[9px] font-black uppercase">REQUEST CORRELATION ID</span>
                    <p className="font-mono text-[10px] text-slate-350 mt-0.5">
                      {selectedRecord.request_id || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-550 text-[9px] font-black uppercase">TIMESTAMP</span>
                    <p className="text-slate-300 mt-0.5 font-mono">
                      {new Date(selectedRecord.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-550 text-[9px] font-black uppercase">ACTION</span>
                    <p className="mt-0.5 font-semibold">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        selectedRecord.action.toLowerCase() === 'block' 
                          ? 'bg-red-500/10 border border-red-500/20 text-red-400' 
                          : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                      }`}>
                        {selectedRecord.action.toUpperCase()}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Actor Details */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                  Actor Details
                </h4>
                <div className="grid grid-cols-2 gap-3.5 p-4 rounded-xl border border-slate-800 bg-[#07070a] text-[11px]">
                  <div>
                    <span className="text-slate-550 text-[9px] font-black uppercase">ACTOR ID</span>
                    <p className="font-mono text-[10px] text-slate-300 mt-0.5 truncate select-all" title={selectedRecord.actor_id}>
                      {selectedRecord.actor_id || "System"}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-550 text-[9px] font-black uppercase">ACTOR TYPE</span>
                    <p className="text-slate-350 mt-0.5 capitalize font-semibold">
                      {selectedRecord.actor_type || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* API Interception Details */}
              {selectedRecord.provider && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                    API Telemetry
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 p-4 rounded-xl border border-slate-800 bg-[#07070a] text-[11px]">
                    <div>
                      <span className="text-slate-550 text-[9px] font-black uppercase">PROVIDER</span>
                      <p className="font-semibold text-slate-300 capitalize mt-0.5">
                        {selectedRecord.provider}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-550 text-[9px] font-black uppercase">MODEL</span>
                      <p className="font-mono text-[10px] text-slate-400 mt-0.5">
                        {selectedRecord.model}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-550 text-[9px] font-black uppercase">STATUS CODE</span>
                      <p className="font-semibold text-slate-300 mt-0.5">
                        {selectedRecord.response_status || "N/A"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-550 text-[9px] font-black uppercase">DURATION</span>
                      <p className="font-semibold text-slate-300 mt-0.5">
                        {selectedRecord.duration_ms !== undefined ? `${selectedRecord.duration_ms} ms` : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Cryptographic Chain Details */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                  Cryptographic Chain Hashes
                </h4>
                <div className="space-y-3.5 p-4 rounded-xl border border-slate-800 bg-[#07070a] text-[10px] font-mono">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-slate-550 text-[9px] font-black uppercase font-sans">PRIOR HASH</span>
                      <button 
                        onClick={() => handleCopy(selectedRecord.prior_hash || '', 'prior_hash')}
                        className="p-0.5 text-slate-550 hover:text-white transition flex items-center gap-1 cursor-pointer font-sans text-[8px] font-bold"
                      >
                        {copiedField === 'prior_hash' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                        Copy
                      </button>
                    </div>
                    <div className="p-2 bg-slate-900/50 rounded border border-slate-850/60 text-slate-400 break-all select-all">
                      {selectedRecord.prior_hash || "GENESIS"}
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-slate-550 text-[9px] font-black uppercase font-sans">INTEGRITY HASH</span>
                      <button 
                        onClick={() => handleCopy(selectedRecord.integrity_hash || '', 'integrity_hash')}
                        className="p-0.5 text-slate-550 hover:text-white transition flex items-center gap-1 cursor-pointer font-sans text-[8px] font-bold"
                      >
                        {copiedField === 'integrity_hash' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                        Copy
                      </button>
                    </div>
                    <div className="p-2 bg-slate-900/50 rounded border border-slate-850/60 text-slate-400 break-all select-all">
                      {selectedRecord.integrity_hash || "N/A"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution Trace */}
              {selectedRecord.execution_trace && selectedRecord.execution_trace !== "[]" && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                    Execution Trace
                  </h4>
                  <div className="p-4 rounded-xl border border-slate-800 bg-[#07070a] space-y-2 max-h-[180px] overflow-y-auto">
                    {(() => {
                      try {
                        const parsed = typeof selectedRecord.execution_trace === 'string' 
                          ? JSON.parse(selectedRecord.execution_trace) 
                          : selectedRecord.execution_trace;
                        if (Array.isArray(parsed)) {
                          return parsed.map((step: any, idx: number) => (
                            <div key={idx} className="flex gap-2 items-start py-1 text-[11px] leading-relaxed border-b border-slate-850/40 last:border-b-0 pb-1.5 last:pb-0">
                              <span className="w-4.5 h-4.5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-[9px] flex-shrink-0">
                                {idx + 1}
                              </span>
                              <span className="font-mono text-slate-350">{typeof step === 'object' ? JSON.stringify(step) : String(step)}</span>
                            </div>
                          ));
                        }
                        return <pre className="font-mono text-slate-400 break-all">{String(selectedRecord.execution_trace)}</pre>;
                      } catch {
                        return <pre className="font-mono text-slate-400 break-all">{String(selectedRecord.execution_trace)}</pre>;
                      }
                    })()}
                  </div>
                </div>
              )}

              {/* Custom Attributes (Supporting future/arbitrary event types) */}
              {(() => {
                const STANDARD_FIELDS = new Set([
                  "record_id", "request_id", "timestamp", "action", "actor_id", "actor_type",
                  "provider", "model", "response_status", "duration_ms", "prior_hash", 
                  "integrity_hash", "execution_trace", "chain_valid", "frameworks_affected"
                ]);
                const customKeys = Object.keys(selectedRecord).filter(key => !STANDARD_FIELDS.has(key));
                if (customKeys.length === 0) return null;
                return (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                      Custom Attributes
                    </h4>
                    <div className="grid grid-cols-2 gap-3.5 p-4 rounded-xl border border-slate-800 bg-[#07070a] text-[11px]">
                      {customKeys.map(key => (
                        <div key={key} className="overflow-hidden">
                          <span className="text-slate-550 text-[9px] font-black uppercase block truncate" title={key}>
                            {key}
                          </span>
                          <span className="font-mono text-[10px] text-slate-350 mt-0.5 break-all block">
                            {typeof selectedRecord[key] === 'object' 
                              ? JSON.stringify(selectedRecord[key]) 
                              : String(selectedRecord[key])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Raw JSON Viewer */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-2.5">
                  Raw Event JSON
                </h4>
                <div className="p-4 rounded-xl border border-slate-800 bg-[#07070a] overflow-x-auto max-h-[280px]">
                  <pre className="font-mono text-[10px] text-slate-400 select-all leading-normal">
                    {JSON.stringify(selectedRecord, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
