"use client";

import React, { useState, useEffect } from "react";
import { 
  Settings, 
  Users, 
  KeyRound, 
  Building, 
  Plus, 
  Trash2, 
  Lock, 
  Unlock,
  CheckCircle,
  Copy,
  Check,
  X,
  AlertTriangle,
  Mail,
  ShieldAlert
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";

interface UserItem {
  id: string;
  email: string;
  role: string;
  mfa_enabled: boolean;
  is_active: boolean;
  created_at: string;
}

interface APIKeyItem {
  id: string;
  name: string;
  scopes: string[];
  is_active: boolean;
  created_at: string;
  last_used?: string | null;
}

interface InviteResult {
  signup_id: string;
  email: string;
  tenant_name: string;
  invited_role: string;
  expires_at: string;
  delivery: string;
  next_resend_at: string;
  dev_otp?: string;
}

interface PendingInvite {
  signup_id: string;
  email: string;
  tenant_name: string;
  invited_role?: string | null;
  expires_at: string;
  sent_at?: string | null;
  resend_count: number;
  delivery?: string | null;
  delivery_error?: string | null;
}

interface SecurityState {
  user_id: string;
  email: string;
  role: string;
  mfa_enabled: boolean;
}

interface MFASetupState extends SecurityState {
  mfa_secret: string;
  provisioning_uri: string;
  backup_codes: string[];
  qr_code_base64: string;
}

interface UsageLimitState {
  limits_enabled: boolean;
  requests_per_minute: number;
  burst_10_seconds: number;
  daily_requests_limit: number;
  max_body_bytes: number;
  max_daily_spend_usd: number;
  estimated_cost_per_1k_requests_usd: number;
  requests_today: number;
  blocked_today: number;
  allowed_today: number;
  bytes_today: number;
  estimated_spend_today_usd: number;
  requests_remaining_today: number;
  spend_remaining_today_usd: number;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"users" | "security" | "keys" | "limits" | "tenant">("users");
  const controlPlaneHost = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  
  // List States
  const [users, setUsers] = useState<UserItem[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [apiKeys, setApiKeys] = useState<APIKeyItem[]>([]);
  const [securityState, setSecurityState] = useState<SecurityState | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MFASetupState | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [usageLimits, setUsageLimits] = useState<UsageLimitState | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState("Unknown");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [sessionRole, setSessionRole] = useState("viewer");
  const [loading, setLoading] = useState(true);

  // User Form Modal States
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("viewer");
  const [userError, setUserError] = useState<string | null>(null);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);

  // Key Form Modal States
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>(["read"]);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [tenantActionError, setTenantActionError] = useState<string | null>(null);
  const [tenantActionBusy, setTenantActionBusy] = useState(false);
  const isOwner = sessionRole === "owner";

  const fetchUsersAndKeys = async () => {
    try {
      // Fetch users
      const uRes = await fetch("/api/users");
      if (uRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (uRes.ok) {
        const uData = await uRes.json();
        setUsers(uData || []);
      }

      const invitesRes = await fetch("/api/users/invites");
      if (invitesRes.ok) {
        const invitesData = await invitesRes.json();
        setPendingInvites(invitesData || []);
      } else if (invitesRes.status === 403) {
        setPendingInvites([]);
      }
      
      // Fetch keys
      const kRes = await fetch("/api/api-keys");
      if (kRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (kRes.ok) {
        const kData = await kRes.json();
        setApiKeys(kData || []);
      }

      // Fetch tenant context from cookie endpoint or simple session endpoint
      const dashboardRes = await fetch("/api/dashboard");
      if (dashboardRes.status === 401) {
        window.location.href = "/login";
        return;
      }

      const tenantRes = await fetch("/api/tenants/current");
      if (tenantRes.ok) {
        const tenantData = await tenantRes.json();
        setTenantStatus(tenantData.status || "active");
      }

      const securityRes = await fetch("/api/users/me/security");
      if (securityRes.ok) {
        setSecurityState(await securityRes.json());
      }

      const usageRes = await fetch("/api/usage-limits");
      if (usageRes.ok) {
        setUsageLimits(await usageRes.json());
        setUsageError(null);
      } else if (usageRes.status !== 403) {
        const usageData = await usageRes.json().catch(() => ({}));
        setUsageError(usageData.error || "Could not load usage limits");
      }
    } catch (err: any) {
      console.warn("Settings fetchUsersAndKeys failed:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/auth/session");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setTenantId(data.tenantId || "Unknown");
        setSessionRole((data.role || "viewer").toLowerCase());
      }
    } catch (err: any) {
      console.warn("Settings fetchSession failed:", err.message);
    }
  };

  useEffect(() => {
    fetchUsersAndKeys();
    fetchSession();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail) return;
    setUserSubmitting(true);
    setUserError(null);

    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          role: userRole
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send invite");
      }

      setUserEmail("");
      setUserRole("viewer");
      setInviteResult(data);
      await fetchUsersAndKeys();
    } catch (err: any) {
      setUserError(err.message || "An unexpected error occurred");
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleCancelInvite = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("Cancel this pending invite? The existing link and OTP will stop working.")) return;
    try {
      const res = await fetch(`/api/users/invites/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel invite");
      setPendingInvites(pendingInvites.filter((invite) => invite.signup_id !== id));
    } catch (err: any) {
      setUserError(err.message || "Could not cancel invite");
    }
  };

  const handleSetupMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const res = await fetch("/api/users/me/mfa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to enable MFA");
      setMfaSetup(data);
      setSecurityState(data);
      await fetchUsersAndKeys();
    } catch (err: any) {
      setMfaError(err.message || "Could not enable MFA");
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!confirm("Disable MFA for your console user? Approval-sensitive actions will no longer ask for your TOTP code.")) return;
    setMfaBusy(true);
    setMfaError(null);
    try {
      const res = await fetch("/api/users/me/mfa/disable", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to disable MFA");
      setMfaSetup(null);
      setSecurityState(data);
      await fetchUsersAndKeys();
    } catch (err: any) {
      setMfaError(err.message || "Could not disable MFA");
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("Are you sure you want to remove this user from the tenant?")) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
      setUsers(users.map((u) => u.id === id ? { ...u, is_active: false } : u));
    } catch (err: any) {
      alert(err.message || "Could not delete user");
    }
  };

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    if (!keyName) return;
    setKeySubmitting(true);
    setKeyError(null);
    setGeneratedKey(null);

    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName,
          scopes: keyScopes
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate key");
      }

      setGeneratedKey(data.api_key);
      setKeyName("");
      setKeyScopes(["read"]);
      await fetchUsersAndKeys();
    } catch (err: any) {
      setKeyError(err.message || "An unexpected error occurred");
    } finally {
      setKeySubmitting(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("Are you sure you want to revoke this API key? Systems utilizing this key will be rejected immediately.")) return;
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke key");
      setApiKeys(apiKeys.filter((k) => k.id !== id));
    } catch (err: any) {
      alert(err.message || "Could not revoke key");
    }
  };

  const toggleScope = (scope: string) => {
    if (keyScopes.includes(scope)) {
      setKeyScopes(keyScopes.filter((s) => s !== scope));
    } else {
      setKeyScopes([...keyScopes, scope]);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedKey) return;
    await copyTextToClipboard(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inviteLink = inviteResult
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/signup?invite=${inviteResult.signup_id}`
    : "";

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await copyTextToClipboard(inviteLink);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const handleTenantStatusChange = async (nextStatus: "active" | "disabled") => {
    if (!isOwner) return;
    const confirmed = confirm(
      nextStatus === "disabled"
        ? "Disable this tenant? Gateway requests and most console actions will be rejected until reactivated."
        : "Reactivate this tenant?"
    );
    if (!confirmed) return;
    setTenantActionBusy(true);
    setTenantActionError(null);
    try {
      const res = await fetch("/api/tenants/current/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to disable tenant");
      }
      setTenantStatus(data.status || nextStatus);
    } catch (err: any) {
      setTenantActionError(err.message || "Could not update tenant status");
    } finally {
      setTenantActionBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
          Tenant Settings
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage tenant members, assign roles, configure API keys, and monitor MFA.
        </p>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b border-slate-800/80 gap-6">
        <button
          onClick={() => setActiveTab("users")}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            activeTab === "users" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "users" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          User Management
        </button>
        <button
          onClick={() => setActiveTab("security")}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            activeTab === "security" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "security" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          Security / MFA
        </button>
        <button
          onClick={() => setActiveTab("keys")}
          disabled={!isOwner}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            !isOwner ? "text-slate-700 cursor-not-allowed" : activeTab === "keys" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "keys" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          API Keys Lifecycle
        </button>
        <button
          onClick={() => setActiveTab("limits")}
          disabled={!isOwner && sessionRole !== "admin"}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            !isOwner && sessionRole !== "admin" ? "text-slate-700 cursor-not-allowed" : activeTab === "limits" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "limits" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          Usage Limits
        </button>
        <button
          onClick={() => setActiveTab("tenant")}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            activeTab === "tenant" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "tenant" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          Tenant Debugging
        </button>
      </div>

      {/* Tab: Users Management */}
      {activeTab === "users" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-[#09090d] border border-slate-800 p-4 rounded-xl">
            <div className="text-xs">
              <h3 className="font-bold text-slate-200 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-indigo-400" />
                Active Members
              </h3>
              <p className="text-slate-500 mt-0.5">Manage permissions and view 2FA setup status.</p>
            </div>
            <button
              onClick={() => { setUserEmail(""); setUserRole("viewer"); setUserError(null); setInviteResult(null); setIsUserModalOpen(true); }}
              disabled={!isOwner}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white font-semibold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              {isOwner ? "Add Member" : "Owner Only"}
            </button>
          </div>

          <div className="rounded-2xl bg-[#09090d] border border-slate-800 shadow-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
              </div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">No users associated with this tenant.</div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#07070a]/40 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4">Role</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Joined At</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {users.map((u) => (
                    <tr key={u.id} className={`hover:bg-slate-800/10 transition-colors ${!u.is_active ? "opacity-55" : ""}`}>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-200">{u.email}</div>
                        <div className="mt-1 text-[10px] text-slate-600">
                          MFA {u.mfa_enabled ? "enabled" : "disabled"}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-350 capitalize border border-slate-700/60 font-semibold text-[10px]">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {u.is_active ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-450">
                            <Lock className="w-3.5 h-3.5 text-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-300">
                            <Unlock className="w-3.5 h-3.5 text-slate-600" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-500 font-mono">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {isOwner && u.is_active ? (
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-1.5 rounded bg-red-950/20 hover:bg-red-950/80 text-red-400 border border-red-900/30 hover:border-red-800 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-600">Owner only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {isOwner && (
            <div className="rounded-2xl bg-[#09090d] border border-slate-800 shadow-xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Pending Invites</h3>
                  <p className="mt-1 text-xs text-slate-500">Track tenant invitations that have not been verified yet.</p>
                </div>
                <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                  {pendingInvites.length} pending
                </span>
              </div>
              {pendingInvites.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">No pending invites.</div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {pendingInvites.map((invite) => (
                    <div key={invite.signup_id} className="flex items-center justify-between gap-4 p-4 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-200">{invite.email}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <span className="capitalize">{invite.invited_role || "viewer"}</span>
                          <span>Expires {new Date(invite.expires_at).toLocaleString()}</span>
                          <span>Sent {invite.resend_count + 1} time{invite.resend_count === 0 ? "" : "s"}</span>
                        </div>
                        {invite.delivery_error && <div className="mt-1 text-[10px] text-red-300">{invite.delivery_error}</div>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setUserEmail(invite.email);
                            setUserRole(invite.invited_role || "viewer");
                            setUserError(null);
                            setInviteResult(null);
                            setIsUserModalOpen(true);
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-800"
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelInvite(invite.signup_id)}
                          className="rounded-lg border border-red-900/50 px-3 py-2 text-[10px] font-semibold text-red-300 hover:bg-red-950/40"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Security / MFA */}
      {activeTab === "security" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white">Multi-Factor Authentication</h3>
                <p className="mt-1 max-w-2xl text-xs text-slate-500">
                  TOTP MFA protects approval-sensitive console actions. Keep backup codes somewhere safe after setup.
                </p>
                {securityState && (
                  <div className="mt-4 text-xs text-slate-400">
                    Signed in as <span className="font-semibold text-slate-200">{securityState.email}</span>{" "}
                    with role <span className="capitalize text-slate-200">{securityState.role}</span>.
                  </div>
                )}
                {mfaError && <div className="mt-3 text-xs text-red-300">{mfaError}</div>}
              </div>
              <span
                className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${
                  securityState?.mfa_enabled
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-200"
                }`}
              >
                MFA {securityState?.mfa_enabled ? "enabled" : "disabled"}
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {!securityState?.mfa_enabled ? (
                <button
                  type="button"
                  onClick={handleSetupMfa}
                  disabled={mfaBusy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {mfaBusy ? "Enabling..." : "Enable MFA"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDisableMfa}
                  disabled={mfaBusy}
                  className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-950/50 disabled:opacity-60"
                >
                  {mfaBusy ? "Disabling..." : "Disable MFA"}
                </button>
              )}
            </div>

            {mfaSetup && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4 flex flex-col items-center justify-center">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-full text-left">Scan with Authenticator App</div>
                  <img 
                    src={`data:image/png;base64,${mfaSetup.qr_code_base64}`} 
                    alt="MFA QR Code" 
                    className="w-32 h-32 rounded bg-white p-1"
                  />
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4 flex flex-col justify-center">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Authenticator Secret (Manual Entry)</div>
                  <div className="select-all break-all font-mono text-xs text-slate-200">{mfaSetup.mfa_secret}</div>
                  <div className="mt-3 text-[10px] text-slate-500">
                    Add this secret to Google Authenticator, 1Password, Authy, or any TOTP app.
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4 md:col-span-2">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Backup Codes</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {mfaSetup.backup_codes.map((code) => (
                      <span key={code} className="rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 text-center">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: API Keys Lifecycle */}
      {activeTab === "keys" && isOwner && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-[#09090d] border border-slate-800 p-4 rounded-xl">
            <div className="text-xs">
              <h3 className="font-bold text-slate-200 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                Active Credentials
              </h3>
              <p className="text-slate-500 mt-0.5">Generate service tokens for application integrations.</p>
            </div>
            <button
              onClick={() => { setKeyName(""); setKeyScopes(["read"]); setKeyError(null); setGeneratedKey(null); setIsKeyModalOpen(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white font-semibold text-xs transition"
            >
              <Plus className="w-4 h-4" />
              Generate API Key
            </button>
          </div>

          <div className="rounded-2xl bg-[#09090d] border border-slate-800 shadow-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">No active API keys found. Click generate to create one.</div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#07070a]/40 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="px-6 py-4">Key ID / Name</th>
                    <th className="px-6 py-4">Scopes</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Created At</th>
                    <th className="px-6 py-4">Last Used</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {apiKeys.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-800/10 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-200">{k.name}</div>
                        <div className="text-[10px] text-slate-550 font-mono mt-0.5">{k.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span key={s} className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] text-slate-400 font-bold border border-slate-700/60 uppercase">
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                          Active
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 font-mono">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-slate-500 font-mono">
                        {k.last_used ? new Date(k.last_used).toLocaleString() : "Never"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleRevokeKey(k.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-red-950/20 hover:bg-red-950/80 text-red-400 border border-red-900/30 hover:border-red-800 text-[10px] font-semibold transition"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab: Usage Limits */}
      {activeTab === "limits" && (isOwner || sessionRole === "admin") && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white">Gateway Usage & Spend Guardrails</h3>
                <p className="mt-1 max-w-2xl text-xs text-slate-500">
                  These caps are enforced at the gateway before provider egress. Spend is an estimate from request volume, not a provider invoice.
                </p>
                {usageError && <p className="mt-2 text-xs text-red-300">{usageError}</p>}
              </div>
              <span
                className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${
                  usageLimits?.limits_enabled
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/25 bg-red-500/10 text-red-200"
                }`}
              >
                Limits {usageLimits?.limits_enabled ? "on" : "off"}
              </span>
            </div>

            {!usageLimits ? (
              <div className="mt-6 rounded-xl border border-slate-800 bg-[#07070a] p-6 text-xs text-slate-500">
                Usage limits are not available for this role or session.
              </div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-4">
                {[
                  ["Requests Today", usageLimits.requests_today.toLocaleString(), `${usageLimits.requests_remaining_today.toLocaleString()} left`],
                  ["Daily Request Cap", usageLimits.daily_requests_limit.toLocaleString(), "Hard gateway limit"],
                  ["Est. Spend Today", `$${usageLimits.estimated_spend_today_usd.toFixed(4)}`, `$${usageLimits.spend_remaining_today_usd.toFixed(2)} left`],
                  ["Blocked Today", usageLimits.blocked_today.toLocaleString(), "Policy/rate blocks"],
                ].map(([label, value, sub]) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-[#07070a] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
                    <div className="mt-2 text-2xl font-bold text-white">{value}</div>
                    <div className="mt-1 text-[10px] text-slate-500">{sub}</div>
                  </div>
                ))}
                <div className="md:col-span-4 grid gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Minute Limit</div>
                    <div className="mt-2 text-sm font-semibold text-slate-200">{usageLimits.requests_per_minute} req/min</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Burst Limit</div>
                    <div className="mt-2 text-sm font-semibold text-slate-200">{usageLimits.burst_10_seconds} req/10s</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Body Limit</div>
                    <div className="mt-2 text-sm font-semibold text-slate-200">{Math.round(usageLimits.max_body_bytes / 1024)} KB</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#07070a] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Spend Guardrail</div>
                    <div className="mt-2 text-sm font-semibold text-slate-200">
                      ${usageLimits.max_daily_spend_usd.toFixed(2)} / day
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Tenant Debugging */}
      {activeTab === "tenant" && (
        <div className="rounded-2xl border border-slate-800 bg-[#09090d] p-6 shadow-xl space-y-6">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Building className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Active Tenant Environment</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed max-w-2xl">
            <div className="space-y-4">
              <div>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Tenant UUID</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="font-mono text-slate-350 select-all px-2.5 py-1.5 rounded bg-[#07070a] border border-slate-850">
                    {tenantId}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Control Plane Host</p>
                <p className="text-slate-300 mt-1 font-mono">{controlPlaneHost}/v1</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Security Strategy</p>
              <p className="text-slate-300 mt-1.5">Row Level Isolation (RLS) is active on the PostgreSQL storage layer.</p>
                <p className="text-slate-500 mt-1.5">Current console role: <span className="capitalize text-slate-300">{sessionRole}</span></p>
              </div>

              <div>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Subscription Tier</p>
                <span className="inline-block px-2.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-semibold text-[10px] mt-1 uppercase">
                  Enterprise Sandbox
                </span>
                <p className="mt-3 text-slate-500 text-[10px] font-bold uppercase tracking-wider">Tenant Status</p>
                <span className={`inline-block px-2.5 py-0.5 rounded font-semibold text-[10px] mt-1 uppercase ${
                  tenantStatus === "active"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-300"
                }`}>
                  {tenantStatus}
                </span>
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="border-t border-slate-800 pt-5 max-w-2xl">
              <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-red-200 flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      Tenant Lifecycle
                    </h4>
                    <p className="text-xs text-red-200/70 mt-1">
                      Disable suspends most access without deleting audit evidence. Reactivate restores normal use.
                    </p>
                    {tenantActionError && <p className="text-xs text-red-300 mt-2">{tenantActionError}</p>}
                  </div>
                  <button
                    onClick={() => handleTenantStatusChange(tenantStatus === "active" ? "disabled" : "active")}
                    disabled={tenantActionBusy}
                    className="shrink-0 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-900/40 disabled:opacity-50"
                  >
                    {tenantActionBusy ? "Updating..." : tenantStatus === "active" ? "Disable" : "Reactivate"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsUserModalOpen(false)} />
          
          <div className="relative w-full max-w-[400px] rounded-2xl bg-[#0e0e15] border border-slate-800 shadow-2xl p-6 overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-800/80 pb-3">
              <h3 className="text-sm font-bold text-white">Invite Tenant Member</h3>
              <button onClick={() => { setInviteResult(null); setIsUserModalOpen(false); }} className="text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {userError && (
              <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                {userError}
              </div>
            )}

            {inviteResult ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-100">
                  Invite sent to <span className="font-semibold">{inviteResult.email}</span> as{" "}
                  <span className="font-semibold capitalize">{inviteResult.invited_role}</span>.
                  {inviteResult.dev_otp && (
                    <div className="mt-2 font-mono text-emerald-200">Demo OTP: {inviteResult.dev_otp}</div>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Invite Verification Link
                  </label>
                  <div className="flex gap-2 rounded-lg border border-slate-800 bg-[#07070a] p-2">
                    <input
                      readOnly
                      value={inviteLink}
                      onFocus={(event) => event.currentTarget.select()}
                      className="min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-300 outline-none"
                    />
                    <button
                      type="button"
                      onClick={copyInviteLink}
                      className="rounded bg-slate-850 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                    >
                      {inviteCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setInviteResult(null); setIsUserModalOpen(false); }}
                    className="px-4 py-2 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-200 font-semibold text-xs transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-600">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    required
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="developer@authclaw.com"
                    className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Role Permission
                </label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
                >
                  <option value="viewer">Viewer (Overview & audit)</option>
                  <option value="admin">Admin (Policies & provider keys)</option>
                  <option value="owner">Owner (Tenant control)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-slate-850 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-350 font-semibold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={userSubmitting}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition active:scale-[0.98] disabled:opacity-50"
                >
                  {userSubmitting ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Generate API Key Modal */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsKeyModalOpen(false)} />
          
          <div className="relative w-full max-w-[450px] rounded-2xl bg-[#0e0e15] border border-slate-800 shadow-2xl p-6 overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-800/80 pb-3">
              <h3 className="text-sm font-bold text-white">Generate Integration Token</h3>
              <button onClick={() => setIsKeyModalOpen(false)} className="text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {keyError && (
              <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                {keyError}
              </div>
            )}

            {generatedKey ? (
              /* Success view displaying the raw secret key EXACTLY ONCE */
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs flex gap-2.5">
                  <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold">Credential Issued Successfully</h4>
                    <p className="mt-0.5">Make sure to copy your API key now. It will not be shown again.</p>
                  </div>
                </div>

                <div className="flex gap-2 p-3.5 rounded-lg bg-[#07070a] border border-slate-800">
                  <span className="flex-1 font-mono text-xs text-indigo-400 truncate tracking-wide select-all">
                    {generatedKey}
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="p-1 rounded bg-slate-850 hover:bg-slate-800 text-slate-350 hover:text-white border border-slate-700 transition"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setIsKeyModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-200 font-semibold text-xs transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              /* Configuration view */
              <form onSubmit={handleGenerateKey} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Token Name / Label
                  </label>
                  <input
                    type="text"
                    required
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. CI/CD Deployment Runner"
                    className="w-full px-3 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/80 transition"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Assigned Scopes
                  </label>
                  <div className="space-y-2 mt-1.5">
                    {["read", "write", "admin"].map((scope) => (
                      <label key={scope} className="flex items-center gap-2 text-xs text-slate-300 capitalize cursor-pointer">
                        <input
                          type="checkbox"
                          checked={keyScopes.includes(scope)}
                          onChange={() => toggleScope(scope)}
                          className="rounded bg-[#07070a] border-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                        />
                        {scope} access
                      </label>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[10px] leading-normal flex gap-2">
                  <AlertTriangle className="w-4.5 h-4.5 text-amber-500 flex-shrink-0" />
                  <span>
                    API Keys have complete access to prompt gateway operations under their assigned scope. Ensure the secret is handled securely.
                  </span>
                </div>

                <div className="pt-4 border-t border-slate-850 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsKeyModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-350 font-semibold text-xs transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={keySubmitting}
                    className="px-4 py-2 rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white font-semibold text-xs shadow-lg transition active:scale-[0.98] disabled:opacity-50"
                  >
                    {keySubmitting ? "Generating..." : "Generate Token"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
