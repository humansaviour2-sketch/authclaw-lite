"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  History,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";

type RuleAction = "redact" | "require_approval" | "block";
type RuleSeverity = "low" | "medium" | "high" | "critical";

interface RedactionRule {
  id: string;
  name: string;
  pattern: string;
  reason: string;
  severity: RuleSeverity;
  action: RuleAction;
}

interface PolicyVersion {
  id: string;
  name: string;
  version: number;
  is_active: boolean;
  created_at: string;
}

const defaultRules: RedactionRule[] = [
  {
    id: "email",
    name: "customer_email",
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b",
    reason: "Email addresses are redacted before model egress.",
    severity: "medium",
    action: "redact",
  },
  {
    id: "health",
    name: "patient_health_data",
    pattern: "(?i)\\b(patient|diagnosis|prescription|medical record)\\b",
    reason: "Health context requires human approval before model egress.",
    severity: "high",
    action: "require_approval",
  },
  {
    id: "ssn",
    name: "ssn_block",
    pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    reason: "SSNs are blocked in the Lite demo policy.",
    severity: "critical",
    action: "block",
  },
];

function yamlQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function buildPolicyYaml(rules: RedactionRule[], modelWhitelist: string[], requestsPerMinute: number) {
  const ruleYaml = rules
    .map((rule) => {
      const lines = [
        `  - name: ${rule.name || "unnamed_rule"}`,
        `    pattern: ${yamlQuote(rule.pattern)}`,
        `    reason: ${yamlQuote(rule.reason || "Custom governance rule matched.")}`,
        `    severity: ${rule.severity}`,
        `    action: ${rule.action}`,
      ];
      if (rule.action === "require_approval") {
        lines.push("    hitl_timeout_seconds: 300");
      }
      return lines.join("\n");
    })
    .join("\n");

  const whitelistYaml = modelWhitelist.length
    ? modelWhitelist.map((model) => `    - ${model}`).join("\n")
    : "    []";

  return `regex_rules:\n${ruleYaml || "  []"}\n\nmodel_rules:\n  whitelist:\n${whitelistYaml}\n  blacklist: []\n\ntopic_rules: []\n\nrate_limits:\n  requests_per_minute: ${requestsPerMinute}`;
}

export default function PoliciesPage() {
  const [rules, setRules] = useState<RedactionRule[]>(defaultRules);
  const [policyName, setPolicyName] = useState("AuthClaw Lite Governance Policy");
  const [policyDesc, setPolicyDesc] = useState("Custom redaction, HITL approval, and block rules for gateway traffic.");
  const [modelInput, setModelInput] = useState("gpt-4o-mini, gemini-2.5-flash-lite");
  const [requestsPerMinute, setRequestsPerMinute] = useState(60);
  const [activeYaml, setActiveYaml] = useState("");
  const [history, setHistory] = useState<PolicyVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modelWhitelist = useMemo(
    () => modelInput.split(",").map((model) => model.trim()).filter(Boolean),
    [modelInput]
  );
  const generatedYaml = useMemo(
    () => buildPolicyYaml(rules, modelWhitelist, requestsPerMinute),
    [rules, modelWhitelist, requestsPerMinute]
  );

  const fetchHistory = async () => {
    const res = await fetch("/api/policies");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) throw new Error("Failed to load policy history");
    const data = await res.json();
    setHistory(data || []);
  };

  useEffect(() => {
    const initialFetch = window.setTimeout(async () => {
      try {
        const [activeRes] = await Promise.all([
          fetch("/api/policies/active"),
          fetchHistory(),
        ]);
        if (activeRes.ok) {
          const active = await activeRes.json();
          setActiveYaml(active.policy_yaml || "");
          setPolicyName(active.name || "AuthClaw Lite Governance Policy");
          setPolicyDesc(active.description || "Custom redaction, HITL approval, and block rules for gateway traffic.");
        }
      } catch (err: unknown) {
        console.warn("Policy bootstrap failed:", errorMessage(err, "Policy bootstrap failed"));
      } finally {
        setLoading(false);
      }
    }, 0);

    return () => window.clearTimeout(initialFetch);
  }, []);

  const addRule = () => {
    setRules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: "custom_rule",
        pattern: "(?i)custom sensitive phrase",
        reason: "Custom sensitive content matched.",
        severity: "medium",
        action: "redact",
      },
    ]);
  };

  const updateRule = (id: string, patch: Partial<RedactionRule>) => {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (id: string) => {
    setRules((current) => current.filter((rule) => rule.id !== id));
  };

  const savePolicy = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: policyName,
          description: policyDesc,
          policy_yaml: generatedYaml,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.detail || "Policy validation failed");
      }
      setActiveYaml(generatedYaml);
      setMessage("Policy deployed. Gateway will use these rules on the next request.");
      await fetchHistory();
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to save policy"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Custom Redaction Policy</h1>
          <p className="text-slate-400 text-sm mt-1">
            Build easy gateway rules for redaction, human approval, or immediate blocking.
          </p>
        </div>
        <button
          onClick={() => void savePolicy()}
          disabled={saving || loading || rules.length === 0}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Deploying..." : "Validate & Deploy"}
        </button>
      </div>

      {message && (
        <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs flex items-start gap-3">
          <Check className="w-4 h-4 text-emerald-400" />
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 space-y-4">
          <div className="rounded-lg bg-[#09090d] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-white text-sm font-bold">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Rule Builder
                </div>
                <p className="text-xs text-slate-500 mt-1">Rules run before model provider egress.</p>
              </div>
              <button
                onClick={addRule}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
              >
                <Plus className="w-4 h-4" />
                Add Rule
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Policy Name</span>
                <input
                  value={policyName}
                  onChange={(event) => setPolicyName(event.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Allowed Models</span>
                <input
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                />
              </label>
            </div>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Description</span>
              <input
                value={policyDesc}
                onChange={(event) => setPolicyDesc(event.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </label>

            <label className="block max-w-xs">
              <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Rate Limit / Minute</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={requestsPerMinute}
                onChange={(event) => setRequestsPerMinute(Number(event.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </label>
          </div>

          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-lg bg-[#09090d] border border-slate-800 p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">{rule.name || "Unnamed rule"}</h3>
                    <p className="text-xs text-slate-500 mt-1">{rule.reason || "No reason provided."}</p>
                  </div>
                  <button
                    onClick={() => removeRule(rule.id)}
                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300"
                    aria-label="Remove rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Rule Name</span>
                    <input
                      value={rule.name}
                      onChange={(event) => updateRule(rule.id, { name: event.target.value.replace(/\s+/g, "_") })}
                      className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Action</span>
                    <select
                      value={rule.action}
                      onChange={(event) => updateRule(rule.id, { action: event.target.value as RuleAction })}
                      className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      <option value="redact">Redact and pass</option>
                      <option value="require_approval">Require HITL approval</option>
                      <option value="block">Block immediately</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Severity</span>
                    <select
                      value={rule.severity}
                      onChange={(event) => updateRule(rule.id, { severity: event.target.value as RuleSeverity })}
                      className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Regex Pattern</span>
                  <input
                    value={rule.pattern}
                    onChange={(event) => updateRule(rule.id, { pattern: event.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                  />
                </label>

                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Reason Shown In Audit / HITL</span>
                  <input
                    value={rule.reason}
                    onChange={(event) => updateRule(rule.id, { reason: event.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                  />
                </label>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg bg-[#09090d] border border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white">Generated YAML</h2>
            </div>
            <pre className="p-4 bg-[#07070a] text-[11px] text-slate-300 overflow-x-auto max-h-[460px]">
              <code>{generatedYaml}</code>
            </pre>
          </section>

          <section className="rounded-lg bg-[#09090d] border border-slate-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white">Deploy History</h2>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No saved policy versions yet.</p>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 6).map((policy) => (
                  <div key={policy.id} className="rounded border border-slate-800 bg-[#07070a] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200 truncate">{policy.name}</span>
                      <span className="text-[10px] text-slate-500">v{policy.version}</span>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">{new Date(policy.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {activeYaml && (
            <section className="rounded-lg bg-[#09090d] border border-slate-800 p-4">
              <h2 className="text-sm font-bold text-white mb-2">Active Policy Loaded</h2>
              <p className="text-xs text-slate-500">
                The builder starts from the Lite template. The active deployed YAML remains visible in history and will be
                replaced when you deploy this generated policy.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
