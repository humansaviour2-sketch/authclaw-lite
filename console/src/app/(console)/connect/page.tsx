"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Code2,
  KeyRound,
  Link2,
  Play,
  Route,
  ShieldCheck,
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";

const providerExamples = {
  openai: {
    label: "OpenAI-compatible chat",
    path: "/v1/chat/completions",
    header: "X-Provider: openai",
    body: `{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "user",
      "content": "My email is jane@example.com. Can you summarize this?"
    }
  ]
}`,
  },
  anthropic: {
    label: "Anthropic-compatible messages",
    path: "/v1/messages",
    header: "X-Provider: anthropic",
    body: `{
  "model": "claude-3-5-sonnet",
  "max_tokens": 300,
  "messages": [
    {
      "role": "user",
      "content": "Patient John Smith has a follow-up next week. Draft a note."
    }
  ]
}`,
  },
  cohere: {
    label: "Cohere-compatible chat",
    path: "/v1/chat",
    header: "X-Provider: cohere",
    body: `{
  "model": "command-r",
  "message": "My email is jane@example.com. Make this answer safe."
}`,
  },
  gemini: {
    label: "Gemini-compatible generation",
    path: "/v1/models/gemini-2.5-flash-lite:generateContent",
    header: "X-Provider: gemini",
    body: `{
  "contents": [
    {
      "parts": [
        { "text": "My phone is 555-123-9911. Make this support response safer." }
      ]
    }
  ]
}`,
  },
};

type Provider = keyof typeof providerExamples;

interface GatewayApproval {
  id: string;
  action_id: string;
  action_description: string;
  action_payload: {
    provider?: string;
    model?: string;
    rule_name?: string;
    reason?: string;
    severity?: string;
    request_id?: string;
  };
  status: string;
  expires_at: string;
  created_at: string;
}

interface ProviderCredential {
  id: string;
  provider: string;
  display_name: string;
  endpoint?: string | null;
  status: string;
  created_at: string;
  rotated_at?: string | null;
}

interface LiteHealthItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

interface GatewayTestResult {
  ok: boolean;
  status: number;
  provider: Provider;
  request_id: string;
  duration_ms: number;
  path: string;
  gateway_url: string;
  response?: unknown;
  raw?: string;
  error?: string;
}

interface OnboardingConnectResult {
  tenant_id?: string;
  tenant_name: string;
  email: string;
  api_key: string;
  gateway_url: string;
  provider: string;
  model: string;
  powershell_snippet: string;
  curl_snippet: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ConnectPage() {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [copied, setCopied] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<GatewayApproval[]>([]);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [credentialProvider, setCredentialProvider] = useState<Provider>("gemini");
  const [credentialName, setCredentialName] = useState("Demo provider key");
  const [credentialKey, setCredentialKey] = useState("");
  const [credentialEndpoint, setCredentialEndpoint] = useState("");
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [healthItems, setHealthItems] = useState<LiteHealthItem[]>([]);
  const [healthReady, setHealthReady] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<GatewayTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [onboardingResult, setOnboardingResult] = useState<OnboardingConnectResult | null>(null);
  const gatewayUrl = onboardingResult?.gateway_url || process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:18080";
  const selected = providerExamples[provider];

  const curlCommand = useMemo(() => {
    return `curl -X POST ${gatewayUrl}${selected.path} \\
  -H "Authorization: Bearer <AUTHCLAW_GATEWAY_KEY>" \\
  -H "${selected.header}" \\
  -H "X-Request-ID: demo-001" \\
  -H "Content-Type: application/json" \\
  -d '${selected.body.replace(/'/g, "'\\''")}'`;
  }, [gatewayUrl, selected]);

  const copy = async (id: string, value: string) => {
    await copyTextToClipboard(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const dismissOnboardingResult = () => {
    window.sessionStorage.removeItem("authclaw_onboarding_result");
    setOnboardingResult(null);
  };

  const fetchApprovals = async () => {
    try {
      const res = await fetch("/api/approvals");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load approvals");
      const data = await res.json();
      setApprovals(data);
      setApprovalError(null);
    } catch (error: unknown) {
      setApprovalError(errorMessage(error, "Failed to load approvals"));
    }
  };

  const fetchCredentials = async () => {
    try {
      const res = await fetch("/api/provider-credentials");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load provider credentials");
      const data = await res.json();
      setCredentials(data);
      setCredentialError(null);
    } catch (error: unknown) {
      setCredentialError(errorMessage(error, "Failed to load provider credentials"));
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/lite-health");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load integration health");
      const data = await res.json();
      setHealthItems(data.items || []);
      setHealthReady(Boolean(data.ready));
      setHealthError(null);
    } catch (error: unknown) {
      setHealthError(errorMessage(error, "Failed to load integration health"));
    }
  };

  useEffect(() => {
    const initialFetch = window.setTimeout(() => {
      void fetchApprovals();
      void fetchCredentials();
      void fetchHealth();
    }, 0);
    const interval = window.setInterval(fetchApprovals, 3000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadOnboardingResult = async () => {
      const saved = window.sessionStorage.getItem("authclaw_onboarding_result");
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as OnboardingConnectResult;
        const sessionRes = await fetch("/api/auth/session", { cache: "no-store" });
        if (!sessionRes.ok) {
          window.sessionStorage.removeItem("authclaw_onboarding_result");
          return;
        }
        const session = await sessionRes.json();
        const belongsToCurrentTenant = parsed.tenant_id && parsed.tenant_id === session.tenantId;
        const belongsToCurrentEmail = parsed.email && parsed.email === session.email;
        if (!belongsToCurrentTenant || !belongsToCurrentEmail) {
          window.sessionStorage.removeItem("authclaw_onboarding_result");
          return;
        }
        if (cancelled) return;
        setOnboardingResult(parsed);
        if (parsed.provider && parsed.provider in providerExamples) {
          setProvider(parsed.provider as Provider);
          setCredentialProvider(parsed.provider as Provider);
        }
      } catch {
        window.sessionStorage.removeItem("authclaw_onboarding_result");
      }
    };

    void loadOnboardingResult();
    return () => {
      cancelled = true;
    };
  }, []);

  const decideApproval = async (id: string, decision: "approve" | "reject") => {
    setApprovalBusy(id);
    try {
      const res = await fetch(`/api/approvals/${id}/${decision}`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed to ${decision} approval`);
      await fetchApprovals();
    } catch (error: unknown) {
      setApprovalError(errorMessage(error, `Failed to ${decision} approval`));
    } finally {
      setApprovalBusy(null);
    }
  };

  const saveCredential = async () => {
    setCredentialSaving(true);
    setCredentialError(null);
    setCredentialMessage(null);
    try {
      const res = await fetch("/api/provider-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: credentialProvider,
          display_name: credentialName,
          api_key: credentialKey,
          endpoint: credentialEndpoint || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.detail || "Failed to save provider key");
      }
      setCredentialKey("");
      setCredentialMessage(`${data.provider} key saved. Gateway can now inject it for upstream calls.`);
      setProvider(data.provider as Provider);
      await fetchCredentials();
      await fetchHealth();
    } catch (error: unknown) {
      setCredentialError(errorMessage(error, "Failed to save provider key"));
    } finally {
      setCredentialSaving(false);
    }
  };

  const revokeCredential = async (id: string) => {
    try {
      const res = await fetch(`/api/provider-credentials/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke provider key");
      await fetchCredentials();
      await fetchHealth();
    } catch (error: unknown) {
      setCredentialError(errorMessage(error, "Failed to revoke provider key"));
    }
  };

  const runGatewayTest = async () => {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/gateway-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gateway test request failed");
      }
      setTestResult(data);
      await fetchHealth();
    } catch (error: unknown) {
      setTestError(errorMessage(error, "Gateway test request failed"));
    } finally {
      setTestBusy(false);
    }
  };

  const pendingApprovals = approvals.filter((approval) => approval.status === "PENDING");
  const activeCredentialForProvider = credentials.some(
    (credential) => credential.provider === provider && credential.status === "active",
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4" />
          Demo onboarding path
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Connect Your AI App</h1>
        <p className="text-sm text-slate-400 max-w-3xl">
          Point an existing chatbot or AI service at the AuthClaw gateway URL. AuthClaw checks the tenant key,
          applies redaction and policy controls, forwards the request to the configured model provider, and records
          the governance evidence.
        </p>
      </div>

      {onboardingResult && (
        <section className="rounded-lg border border-emerald-500/25 bg-[#09110f] overflow-hidden">
          <div className="border-b border-emerald-500/20 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-100">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Tenant Ready
                </div>
                <p className="mt-1 text-xs text-emerald-200/70">
                  {onboardingResult.tenant_name} is signed in. Copy the first gateway key now, then save a provider key below.
                </p>
              </div>
              <button
                type="button"
                onClick={dismissOnboardingResult}
                className="rounded-lg border border-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/10"
              >
                Hide
              </button>
            </div>
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">
                    First AuthClaw Gateway Key
                  </span>
                  <button
                    type="button"
                    onClick={() => copy("onboarding-key", onboardingResult.api_key)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-200 hover:text-white"
                  >
                    {copied === "onboarding-key" ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                    {copied === "onboarding-key" ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-emerald-500/20 bg-black/25 p-3 text-xs text-emerald-50">
                  {onboardingResult.api_key}
                </pre>
                <p className="mt-2 text-[10px] text-emerald-200/60">This raw key is shown from onboarding only. Store it before hiding this panel.</p>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">Gateway URL</span>
                  <button
                    type="button"
                    onClick={() => copy("onboarding-gateway", onboardingResult.gateway_url)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-200 hover:text-white"
                  >
                    {copied === "onboarding-gateway" ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                    {copied === "onboarding-gateway" ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-emerald-500/20 bg-black/25 p-3 text-xs text-emerald-50">
                  {onboardingResult.gateway_url}
                </pre>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/70">PowerShell Starter Request</span>
                <button
                  type="button"
                  onClick={() => copy("onboarding-powershell", onboardingResult.powershell_snippet)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-200 hover:text-white"
                >
                  {copied === "onboarding-powershell" ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                  {copied === "onboarding-powershell" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-emerald-500/20 bg-black/25 p-3 text-xs text-emerald-50">
                {onboardingResult.powershell_snippet}
              </pre>
              <button
                type="button"
                onClick={() => copy("onboarding-curl", onboardingResult.curl_snippet)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {copied === "onboarding-curl" ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                {copied === "onboarding-curl" ? "Copied curl" : "Copy curl instead"}
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="rounded-lg bg-[#09090d] border border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Link2 className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-white">1. Use The Gateway URL</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">Replace the model provider base URL in the customer app.</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#07070a] px-3 py-2">
            <code className="text-xs text-slate-200 flex-1 truncate">{gatewayUrl}</code>
            <button
              onClick={() => copy("gateway", gatewayUrl)}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
              aria-label="Copy gateway URL"
            >
              {copied === "gateway" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clipboard className="w-3.5 h-3.5" />}
            </button>
          </div>
        </section>

        <section className="rounded-lg bg-[#09090d] border border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white">2. Send AuthClaw Key</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Runtime traffic uses an AuthClaw gateway key, not the customer provider key.
          </p>
          <div className="rounded-lg border border-slate-800 bg-[#07070a] px-3 py-2">
            <code className="text-xs text-slate-200">Authorization: Bearer {"<AUTHCLAW_GATEWAY_KEY>"}</code>
          </div>
        </section>

        <section className="rounded-lg bg-[#09090d] border border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Route className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold text-white">3. Select Provider Route</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">AuthClaw uses the provider route to apply the right policy and adapter.</p>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
            className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80"
          >
            {Object.entries(providerExamples).map(([id, item]) => (
              <option key={id} value={id}>
                {item.label}
              </option>
            ))}
          </select>
        </section>
      </div>

      <section className="rounded-lg bg-[#09090d] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <ShieldCheck className={healthReady ? "w-4 h-4 text-emerald-400" : "w-4 h-4 text-amber-400"} />
              Integration Health
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Checks whether the Lite gateway path is ready for a demo request.
            </p>
          </div>
          <button
            onClick={() => void fetchHealth()}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
          >
            Recheck
          </button>
        </div>
        {healthError && (
          <div className="m-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
            {healthError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-5">
          {healthItems.length === 0 ? (
            <p className="text-xs text-slate-500 md:col-span-5">Health checks have not run yet.</p>
          ) : (
            healthItems.map((item) => (
              <div key={item.key} className="rounded-lg border border-slate-800 bg-[#07070a] p-3">
                <div className="flex items-center gap-2">
                  {item.ok ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  )}
                  <span className="text-xs font-bold text-slate-200">{item.label}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">{item.detail}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg bg-[#09090d] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white font-bold text-sm">
            <KeyRound className="w-4 h-4 text-amber-400" />
            Provider Key Vault
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Store the customer model-provider key once. AuthClaw uses this upstream key after governance checks pass.
          </p>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Provider</span>
            <select
              value={credentialProvider}
              onChange={(event) => setCredentialProvider(event.target.value as Provider)}
              className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="cohere">Cohere</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Display Name</span>
            <input
              value={credentialName}
              onChange={(event) => setCredentialName(event.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Provider API Key</span>
            <input
              type="password"
              value={credentialKey}
              onChange={(event) => setCredentialKey(event.target.value)}
              placeholder="Paste provider key"
              className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Endpoint Override</span>
            <input
              value={credentialEndpoint}
              onChange={(event) => setCredentialEndpoint(event.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80"
            />
          </label>
        </div>

        <div className="px-5 pb-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="text-xs">
            {credentialMessage && <p className="text-emerald-300">{credentialMessage}</p>}
            {credentialError && <p className="text-red-300">{credentialError}</p>}
            {!credentialMessage && !credentialError && (
              <p className="text-slate-500">Raw provider keys are encrypted and never returned after save.</p>
            )}
          </div>
          <button
            onClick={() => void saveCredential()}
            disabled={credentialSaving || credentialKey.length < 8}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {credentialSaving ? "Saving..." : "Save Provider Key"}
          </button>
        </div>

        <div className="mx-5 mb-5 rounded-lg border border-slate-800 bg-[#07070a] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Play className="h-4 w-4 text-emerald-400" />
                Test Gateway Request
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Sends a safe sample prompt through AuthClaw using the current tenant key and selected provider route.
              </p>
            </div>
            <button
              onClick={() => void runGatewayTest()}
              disabled={testBusy || !activeCredentialForProvider}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {testBusy ? "Testing..." : `Test ${providerExamples[provider].label}`}
            </button>
          </div>

          {!activeCredentialForProvider && (
            <p className="mt-3 text-xs text-amber-200">
              Save an active {providerExamples[provider].label} provider key first, then run the gateway test.
              {provider === "openai" ? " You can leave OpenAI untested until you have an OpenAI API key." : ""}
            </p>
          )}
          {testError && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
              {testError}
            </div>
          )}
          {testResult && (
            <div
              className={`mt-3 rounded-lg border p-3 text-xs ${
                testResult.ok
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                  : "border-amber-500/20 bg-amber-500/10 text-amber-100"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {testResult.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <span className="font-bold">
                  {testResult.ok ? "Gateway request succeeded" : `Gateway returned ${testResult.status}`}
                </span>
                <span className="text-slate-400">Request ID: {testResult.request_id}</span>
                <span className="text-slate-400">{testResult.duration_ms}ms</span>
              </div>
              <pre className="mt-3 max-h-56 overflow-auto rounded border border-black/20 bg-black/20 p-3 text-[11px] text-slate-100">
                {JSON.stringify(testResult.response ?? testResult.raw ?? testResult.error ?? {}, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 divide-y divide-slate-800">
          {credentials.length === 0 ? (
            <div className="p-5 text-xs text-slate-500">No provider keys configured yet.</div>
          ) : (
            credentials.map((credential) => (
              <div key={credential.id} className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{credential.display_name}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-semibold uppercase text-slate-300">
                      {credential.provider}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold uppercase text-emerald-300">
                      {credential.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Created {new Date(credential.created_at).toLocaleString()}
                    {credential.endpoint ? ` / endpoint override configured` : ""}
                  </p>
                </div>
                <button
                  onClick={() => void revokeCredential(credential.id)}
                  className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold text-red-300"
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg bg-[#09090d] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Code2 className="w-4 h-4 text-indigo-400" />
              Copyable curl Request
            </div>
            <p className="text-xs text-slate-500 mt-1">
              macOS/Linux curl format. On Windows, use the PowerShell starter request from the Tenant Ready panel.
            </p>
          </div>
          <button
            onClick={() => copy("curl", curlCommand)}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
          >
            {copied === "curl" ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
            Copy curl
          </button>
        </div>
        <pre className="p-5 overflow-x-auto text-xs text-slate-200 bg-[#07070a]">
          <code>{curlCommand}</code>
        </pre>
      </section>

      <section className="rounded-lg bg-[#09090d] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              HITL Approval Queue
            </div>
            <p className="text-xs text-slate-500 mt-1">
              High-risk policy matches wait here. If no one approves within 5 minutes, the gateway blocks the request.
            </p>
          </div>
          <button
            onClick={() => void fetchApprovals()}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
          >
            Refresh
          </button>
        </div>

        {approvalError && (
          <div className="m-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
            {approvalError}
          </div>
        )}

        {pendingApprovals.length === 0 ? (
          <div className="p-5 text-xs text-slate-500">No pending gateway approvals.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {approval.action_payload.rule_name || "Custom policy match"}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold uppercase text-amber-300">
                      {approval.action_payload.severity || "high"}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-semibold text-slate-300">
                      {approval.action_payload.provider || "provider"} / {approval.action_payload.model || "model"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    {approval.action_payload.reason || approval.action_description}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Request {approval.action_payload.request_id || approval.action_id} expires {new Date(approval.expires_at).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void decideApproval(approval.id, "reject")}
                    disabled={approvalBusy === approval.id}
                    className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-semibold text-red-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => void decideApproval(approval.id, "approve")}
                    disabled={approvalBusy === approval.id}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Approve Passage
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          "Tenant key validated",
          "PII/PHI redaction applied",
          "Policy allow/block decision recorded",
          "Audit evidence emitted",
        ].map((item) => (
          <div key={item} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#09090d] px-4 py-3">
            <Play className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-slate-300">{item}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
