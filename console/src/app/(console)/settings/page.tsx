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
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"users" | "keys" | "tenant">("users");
  const controlPlaneHost = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  
  // List States
  const [users, setUsers] = useState<UserItem[]>([]);
  const [apiKeys, setApiKeys] = useState<APIKeyItem[]>([]);
  const [tenantId, setTenantId] = useState("Unknown");
  const [loading, setLoading] = useState(true);

  // User Form Modal States
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("viewer");
  const [userError, setUserError] = useState<string | null>(null);
  const [userSubmitting, setUserSubmitting] = useState(false);

  // Key Form Modal States
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>(["read"]);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          password: "temporary_password_123", // required by UserCreate schema
          role: userRole
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      setUserEmail("");
      setUserRole("viewer");
      setIsUserModalOpen(false);
      await fetchUsersAndKeys();
    } catch (err: any) {
      setUserError(err.message || "An unexpected error occurred");
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm("Are you sure you want to remove this user from the tenant?")) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
      setUsers(users.filter((u) => u.id !== id));
    } catch (err: any) {
      alert(err.message || "Could not delete user");
    }
  };

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const copyToClipboard = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
          Tenant Settings
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage tenant members, allocate developer roles, configure API keys, and monitor MFA.
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
          onClick={() => setActiveTab("keys")}
          className={`pb-3.5 text-sm font-semibold transition relative ${
            activeTab === "keys" ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {activeTab === "keys" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
          API Keys Lifecycle
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
              onClick={() => { setUserEmail(""); setUserRole("viewer"); setUserError(null); setIsUserModalOpen(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white font-semibold text-xs transition"
            >
              <Plus className="w-4 h-4" />
              Add Member
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
                    <th className="px-6 py-4">MFA Status</th>
                    <th className="px-6 py-4">Joined At</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-800/10 transition-colors">
                      <td className="px-6 py-4 font-semibold text-slate-200">{u.email}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-350 capitalize border border-slate-700/60 font-semibold text-[10px]">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {u.mfa_enabled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-450">
                            <Lock className="w-3.5 h-3.5 text-emerald-500" />
                            Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                            <Unlock className="w-3.5 h-3.5 text-slate-600" />
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-500 font-mono">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 rounded bg-red-950/20 hover:bg-red-950/80 text-red-400 border border-red-900/30 hover:border-red-800 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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

      {/* Tab: API Keys Lifecycle */}
      {activeTab === "keys" && (
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
              </div>

              <div>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Subscription Tier</p>
                <span className="inline-block px-2.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-semibold text-[10px] mt-1 uppercase">
                  Enterprise Sandbox
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsUserModalOpen(false)} />
          
          <div className="relative w-full max-w-[400px] rounded-2xl bg-[#0e0e15] border border-slate-800 shadow-2xl p-6 overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-800/80 pb-3">
              <h3 className="text-sm font-bold text-white">Add Tenant Member</h3>
              <button onClick={() => setIsUserModalOpen(false)} className="text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {userError && (
              <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                {userError}
              </div>
            )}

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
                  <option value="viewer">Viewer (Read-only)</option>
                  <option value="developer">Developer (Keys & snippets)</option>
                  <option value="operator">Operator (Legacy read / write)</option>
                  <option value="admin">Admin (Policy & users)</option>
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
                  {userSubmitting ? "Adding..." : "Add Member"}
                </button>
              </div>
            </form>
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
