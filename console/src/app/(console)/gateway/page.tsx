"use client";

import React, { useState, useEffect } from "react";
import { 
  Cpu, 
  Plus, 
  Trash2, 
  Edit, 
  Activity, 
  EyeOff, 
  AlertTriangle,
  X,
  ShieldCheck,
  Clock
} from "lucide-react";

interface GatewayRoute {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  redaction_strategy: string;
  model_whitelist?: string[];
  is_active: boolean;
  created_at: string;
}

interface AuditLog {
  record_id: string;
  timestamp: string;
  action: string;
  provider: string;
  model: string;
  reason: string;
  response_status: number;
  duration_ms: number;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function GatewayPage() {
  const [routes, setRoutes] = useState<GatewayRoute[]>([]);
  const [traffic, setTraffic] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"routes" | "inspector">("routes");
  const [error, setError] = useState<string | null>(null);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [selectedRoute, setSelectedRoute] = useState<GatewayRoute | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [endpoint, setEndpoint] = useState("");
  const [redactionStrategy, setRedactionStrategy] = useState("mask");
  const [whitelistInput, setWhitelistInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchRoutes = async () => {
    try {
      const res = await fetch("/api/gateways");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch gateway routes");
      const data = await res.json();
      setRoutes(data);
      setError(null);
    } catch (err: unknown) {
      const message = errorMessage(err, "Failed to load gateway configurations");
      console.warn("Gateway fetchRoutes failed:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTraffic = async () => {
    try {
      const res = await fetch("/api/audit?limit=20");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch audit traffic");
      const data = await res.json();
      setTraffic(data.records || []);
      setTrafficError(null);
    } catch (err: unknown) {
      const message = errorMessage(err, "Failed to load live traffic logs");
      console.warn("Gateway fetchTraffic failed:", message);
      setTrafficError(message);
    } finally {
      setTrafficLoading(false);
    }
  };

  useEffect(() => {
    const initialFetch = window.setTimeout(() => {
      void fetchRoutes();
      void fetchTraffic();
    }, 0);
    const interval = setInterval(fetchTraffic, 5000);
    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, []);

  const openAddModal = () => {
    setName("");
    setProvider("openai");
    setEndpoint("https://api.openai.com/v1/chat/completions");
    setRedactionStrategy("mask");
    setWhitelistInput("gpt-4o, gpt-4-turbo, gpt-3.5-turbo");
    setFormError(null);
    setModalMode("add");
    setIsModalOpen(true);
  };

  const openEditModal = (route: GatewayRoute) => {
    setSelectedRoute(route);
    setName(route.name);
    setProvider(route.provider);
    setEndpoint(route.endpoint);
    setRedactionStrategy(route.redaction_strategy);
    setWhitelistInput(route.model_whitelist ? route.model_whitelist.join(", ") : "");
    setFormError(null);
    setModalMode("edit");
    setIsModalOpen(true);
  };

  const handleProviderChange = (prov: string) => {
    setProvider(prov);
    if (prov === "openai") {
      setEndpoint("https://api.openai.com/v1/chat/completions");
      setWhitelistInput("gpt-4o, gpt-4-turbo, gpt-3.5-turbo");
    } else if (prov === "anthropic") {
      setEndpoint("https://api.anthropic.com/v1/messages");
      setWhitelistInput("claude-3-5-sonnet, claude-3-opus, claude-3-haiku");
    } else if (prov === "cohere") {
      setEndpoint("https://api.cohere.ai/v2/chat");
      setWhitelistInput("command-r-plus, command-r");
    } else if (prov === "azure_openai") {
      setEndpoint("https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT/chat/completions");
      setWhitelistInput("gpt-4o, gpt-4");
    } else if (prov === "gemini") {
      setEndpoint("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent");
      setWhitelistInput("gemini-2.5-flash-lite, gemini-2.5-flash, gemini-2.5-pro");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !endpoint) {
      setFormError("Name and Endpoint fields are required");
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const model_whitelist = whitelistInput
      ? whitelistInput.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    const payload = {
      name,
      provider,
      endpoint,
      redaction_strategy: redactionStrategy,
      model_whitelist,
    };

    try {
      let res;
      if (modalMode === "add") {
        res = await fetch("/api/gateways", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/gateways/${selectedRoute?.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save route");
      }

      await fetchRoutes();
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(errorMessage(err, "An unexpected error occurred"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this gateway configuration?")) return;
    try {
      const res = await fetch(`/api/gateways/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete gateway");
      setRoutes(routes.filter((r) => r.id !== id));
    } catch (err: unknown) {
      alert(errorMessage(err, "Could not delete route"));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Governance Gateway
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Configure provider-compatible routes that customer apps call through the AuthClaw URL.
          </p>
        </div>
        <button 
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          Add Provider Route
        </button>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b border-slate-800/80 gap-6">
        <button
          onClick={() => setActiveTab("routes")}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            activeTab === "routes" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "routes" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          Provider Routes
        </button>
        <button
          onClick={() => setActiveTab("inspector")}
          className={`pb-3.5 text-sm font-semibold transition relative flex items-center gap-1.5 ${
            activeTab === "inspector" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "inspector" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          Live Traffic Inspector
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </button>
      </div>

      {/* Tab: Routes Configuration */}
      {activeTab === "routes" && (
        <div className="space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[300px]">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-500 mb-2" />
              <p className="text-xs text-slate-500 font-medium">Resolving routing tables...</p>
            </div>
          ) : error ? (
            <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-red-900/30 p-12 flex flex-col items-center justify-center text-center min-h-[300px]">
              <div className="w-12 h-12 rounded-xl bg-red-950/20 border border-red-900/30 flex items-center justify-center mb-4 text-red-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-200">Backend Unavailable</h3>
              <p className="text-slate-500 text-xs max-w-sm mt-2">
                {error}
              </p>
            </div>
          ) : routes.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800/80 p-12 flex flex-col items-center justify-center text-center min-h-[300px]">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
              <div className="w-12 h-12 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-center mb-4 text-indigo-400">
                <Cpu className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-200">No Provider Routes Configured</h3>
              <p className="text-slate-500 text-xs max-w-sm mt-2">
                Configure the first model provider route before sending chatbot traffic through AuthClaw.
              </p>
              <button 
                onClick={openAddModal}
                className="mt-6 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 transition"
              >
                Configure First Provider
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {routes.map((route) => (
                <div key={route.id} className="relative overflow-hidden rounded-2xl bg-[#09090d] border border-slate-800 p-6 flex flex-col justify-between shadow-xl hover:border-slate-700/80 transition group">
                  <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-indigo-500/5 blur-[40px] pointer-events-none" />
                  
                  <div>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-600/10 border border-indigo-500/20 text-indigo-400">
                          {route.provider.replace("_", " ")}
                        </span>
                        <h3 className="text-lg font-bold text-white mt-2 group-hover:text-indigo-400 transition">{route.name}</h3>
                      </div>
                      
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition duration-150">
                        <button
                          onClick={() => openEditModal(route)}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(route.id)}
                          className="p-1.5 rounded bg-red-950/20 hover:bg-red-950/80 text-red-400 border border-red-900/30 hover:border-red-800 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2.5 text-xs">
                      <div>
                        <p className="text-slate-500 text-[10px]">ENDPOINT</p>
                        <p className="font-mono text-slate-300 truncate mt-0.5">{route.endpoint}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">REDACTION STRATEGY</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <EyeOff className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-semibold text-slate-200 capitalize">{route.redaction_strategy} Strategy</span>
                        </div>
                      </div>
                      {route.model_whitelist && route.model_whitelist.length > 0 && (
                        <div>
                          <p className="text-slate-500 text-[10px]">MODEL WHITELIST</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {route.model_whitelist.map((m) => (
                              <span key={m} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700/60">
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-500">
                    <span>Active Route</span>
                    <span className="font-mono text-[10px] text-slate-600">{route.id}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Live Traffic Inspector */}
      {activeTab === "inspector" && (
        <div className="rounded-2xl bg-[#09090d] border border-slate-800/80 shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800/80 bg-[#0c0c12]/60 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Live Ingress Traffic
            </h3>
            <span className="text-[10px] text-slate-500 font-semibold">Updates every 5s</span>
          </div>

          <div className="overflow-x-auto">
            {trafficLoading ? (
              <div className="flex flex-col items-center justify-center min-h-[250px]">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mb-2" />
                <p className="text-[10px] text-slate-500">Listening to traffic socket...</p>
              </div>
            ) : trafficError ? (
              <div className="p-12 text-center text-red-450 flex flex-col items-center justify-center min-h-[250px]">
                <AlertTriangle className="w-8 h-8 mb-3 text-red-400" />
                <h4 className="text-sm font-semibold">Traffic Log Failed</h4>
                <p className="text-xs text-slate-550 mt-1">{trafficError}</p>
              </div>
            ) : traffic.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center min-h-[250px]">
                <Clock className="w-10 h-10 text-slate-600 mb-3" />
                <h4 className="text-sm font-semibold text-slate-300">No data available yet</h4>
                <p className="text-slate-500 text-xs max-w-xs mt-1">
                  Once your configured proxy starts receiving calls from application workers, logs will show up here.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#07070a]/40 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="px-6 py-3.5">Timestamp</th>
                    <th className="px-6 py-3.5">Provider / Model</th>
                    <th className="px-6 py-3.5">Action</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {traffic.map((log) => {
                    const isBlock = log.action.toLowerCase() === "block";
                    return (
                      <tr key={log.record_id} className="hover:bg-slate-800/10 transition-colors">
                        <td className="px-6 py-4 text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-200 capitalize">{log.provider}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{log.model}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isBlock 
                              ? "bg-red-500/10 border border-red-500/20 text-red-400" 
                              : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          }`}>
                            {isBlock ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                            {log.action.toUpperCase()}
                          </span>
                          {log.reason && log.reason !== "None" && (
                            <div className="text-[10px] text-slate-500 mt-1 max-w-[200px] truncate" title={log.reason}>
                              {log.reason}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`font-mono font-bold ${
                            log.response_status >= 200 && log.response_status < 300 
                              ? "text-emerald-400" 
                              : "text-red-400"
                          }`}>
                            {log.response_status || "200"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-slate-300">
                          {log.duration_ms || log.duration_ms === 0 ? `${log.duration_ms} ms` : "No data"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Config Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          
          <div className="relative w-full max-w-[500px] rounded-2xl bg-[#0e0e15] border border-slate-800 shadow-2xl p-6 overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-800/80 pb-3">
              <h3 className="text-base font-bold text-white">
                {modalMode === "add" ? "Register Provider Route" : "Edit Provider Route"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Route Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Production OpenAI Gateway"
                  className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="cohere">Cohere</option>
                    <option value="azure_openai">Azure OpenAI</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Redaction strategy
                  </label>
                  <select
                    value={redactionStrategy}
                    onChange={(e) => setRedactionStrategy(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
                  >
                    <option value="mask">Masking ([REDACTED])</option>
                    <option value="hash">SHA-256 + Salt Hashing</option>
                    <option value="synthetic">Synthetic replacement</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Endpoint URL
                </label>
                <input
                  type="text"
                  required
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://api.openai.com/v1/chat/completions"
                  className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Model Whitelist (comma-separated, leave blank for all)
                </label>
                <input
                  type="text"
                  value={whitelistInput}
                  onChange={(e) => setWhitelistInput(e.target.value)}
                  placeholder="gpt-4o, gpt-4, gpt-3.5-turbo"
                  className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-indigo-500/80 transition"
                />
              </div>

              <div className="pt-4 border-t border-slate-850 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white font-semibold text-xs shadow-lg transition active:scale-[0.98] disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Route"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
