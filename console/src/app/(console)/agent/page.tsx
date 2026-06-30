"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Bot, 
  Send, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  X,
  User, 
  Sparkles,
  KeyRound,
  Lock,
  Loader2,
  Terminal,
  Activity,
  Plus,
  MessageSquare,
  ExternalLink,
  BookOpen
} from "lucide-react";

interface Workflow {
  id: string;
  workflow_id: string;
  framework: string;
  current_state: string;
  execution_status: string;
  risk_score: number | null;
  findings?: Finding[];
  remediation_plan?: RemediationPlan[];
  remediation_state?: string | null;
  remediation_actions?: RemediationAction[];
  rollback_result?: RollbackResult | null;
  execution_result?: RemediationExecutionResult | null;
  error_message?: string | null;
  retry_count?: number;
  state_data?: WorkflowStateData;
  started_at: string;
  completed_at: string | null;
  approval_id: string | null;
}

interface Approval {
  id: string;
  action_id: string;
  action_type: string;
  action_description: string;
  status: string;
  expires_at: string;
  created_at: string;
}

interface Message {
  sender: "user" | "agent";
  text: string;
  timestamp: Date;
  results?: AgentResult;
}

interface ChatSession {
  id: string;
  title: string;
}

interface ChatHistoryMessage {
  sender: "user" | "agent";
  text: string;
  timestamp: string;
  results?: AgentResult;
}

interface Finding {
  control?: string;
  status?: string;
  description?: string;
  evidence?: string;
}

interface RemediationPlan {
  action?: string;
  priority?: string;
  finding_control?: string;
  estimated_effort?: string;
}

interface RAGCitation {
  id: string;
  framework: string;
  section_id: string;
  label: string;
  title: string;
  source_name: string;
  url: string;
  score: number;
}

interface RAGChunk extends RAGCitation {
  text: string;
}

interface RAGAnswerResult {
  type: "rag_answer";
  question: string;
  corpus_version?: string | null;
  corpus_checksum?: string | null;
  grounded: boolean;
  citations: RAGCitation[];
  retrieved_chunks: RAGChunk[];
}

interface RemediationAction {
  id?: string;
  finding_control?: string;
  action?: string;
  status?: string;
  attempts?: number;
  completed_at?: string;
  last_error?: string;
  rollback_result?: {
    status?: string;
    details?: string;
  };
  result?: {
    control?: string;
    details?: string;
  };
}

interface RollbackResult {
  rollback_successful?: number;
  rollback_failed?: number;
}

interface RemediationExecutionResult {
  remediation_state?: string;
  actions_successful?: number;
  actions_executed?: number;
  actions?: RemediationAction[];
}

interface WorkflowStateData {
  remediation_actions?: RemediationAction[];
  rollback_result?: RollbackResult | null;
}

type WorkflowInspection = Partial<Workflow> & {
  workflow_id?: string;
};

type AgentResult = WorkflowInspection | RAGAnswerResult;

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const isRagResult = (result?: AgentResult | null): result is RAGAnswerResult => {
  return Boolean(result && "type" in result && result.type === "rag_answer");
};

const isWorkflowResult = (result?: AgentResult | null): result is WorkflowInspection => {
  return Boolean(result && "workflow_id" in result && result.workflow_id);
};

const formatStateLabel = (value?: string | null) => {
  if (!value) return "Not Started";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
};

const getRemediationActions = (workflow?: WorkflowInspection | null): RemediationAction[] => {
  return workflow?.remediation_actions || workflow?.execution_result?.actions || workflow?.state_data?.remediation_actions || [];
};

const getRollbackResult = (workflow?: WorkflowInspection | null): RollbackResult | null => {
  return workflow?.rollback_result || workflow?.state_data?.rollback_result || null;
};

const getActionStatusClass = (status?: string) => {
  switch (status) {
    case "SUCCEEDED":
    case "ROLLED_BACK":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "FAILED":
    case "ROLLBACK_FAILED":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "RUNNING":
      return "bg-sky-500/10 text-sky-400 border-sky-500/20 animate-pulse";
    default:
      return "bg-slate-800/70 text-slate-400 border-slate-700";
  }
};

function RemediationTimeline({ workflow }: { workflow: WorkflowInspection }) {
  const actions = getRemediationActions(workflow);
  const rollback = getRollbackResult(workflow);
  const result = workflow?.execution_result || {};
  const remediationState = workflow?.remediation_state || result.remediation_state || "NOT_STARTED";

  if (!actions.length && !workflow?.approval_id && !workflow?.error_message) {
    return (
      <div className="space-y-2 text-[10px] text-slate-400">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Initial scan completed.</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-slate-500" />
          <span>No remediation has been applied yet.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-850 pb-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">State Machine</p>
          <p className="text-slate-250 font-bold">{formatStateLabel(remediationState)}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[9px]">
          <span className="px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900/40 text-slate-400">
            {result.actions_successful ?? 0}/{result.actions_executed ?? actions.length} successful
          </span>
          {typeof workflow?.retry_count === "number" && workflow.retry_count > 0 && (
            <span className="px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-400">
              {workflow.retry_count} retr{workflow.retry_count === 1 ? "y" : "ies"}
            </span>
          )}
        </div>
      </div>

      {workflow?.approval_id && !actions.length && (
        <div className="flex items-center gap-2 text-[10px] text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Awaiting approval: {workflow.approval_id}</span>
        </div>
      )}

      {actions.length > 0 && (
        <div className="space-y-2">
          {actions.map((action: RemediationAction, idx: number) => (
            <div key={action.id || idx} className="relative pl-5">
              <div className="absolute left-1.5 top-1 h-full w-px bg-slate-800" />
              <div className={`absolute left-0 top-1.5 h-3 w-3 rounded-full border ${
                action.status === "FAILED" || action.status === "ROLLBACK_FAILED"
                  ? "bg-red-500/20 border-red-400"
                  : action.status === "SUCCEEDED" || action.status === "ROLLED_BACK"
                    ? "bg-emerald-500/20 border-emerald-400"
                    : "bg-sky-500/20 border-sky-400"
              }`} />
              <div className="rounded border border-slate-850 bg-[#050509] p-2.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-slate-300 break-all">{action.finding_control || action.result?.control || "Unknown control"}</p>
                    <p className="text-[10px] text-slate-500 leading-normal">{action.action || action.result?.details || "Remediation action"}</p>
                  </div>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[8px] font-black uppercase ${getActionStatusClass(action.status)}`}>
                    {formatStateLabel(action.status)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-[9px] text-slate-500">
                  <span>Attempts: {action.attempts || 0}</span>
                  {action.completed_at && <span>Completed: {new Date(action.completed_at).toLocaleTimeString()}</span>}
                  {action.last_error && <span className="text-red-400">Error: {action.last_error}</span>}
                </div>
                {action.rollback_result && (
                  <div className="rounded border border-emerald-500/10 bg-emerald-500/5 p-2 text-[9px] text-emerald-300 leading-normal">
                    Rollback: {action.rollback_result.details || action.rollback_result.status}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rollback && (
        <div className="rounded border border-slate-800 bg-slate-950/50 p-2.5 text-[10px] space-y-1">
          <div className="flex items-center gap-2 text-slate-300 font-bold">
            {(rollback.rollback_failed || 0) > 0 ? (
              <XCircle className="w-3.5 h-3.5 text-red-400" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>Rollback Result</span>
          </div>
          <p className="text-slate-500">
            {rollback.rollback_successful || 0} succeeded, {rollback.rollback_failed || 0} failed.
          </p>
        </div>
      )}

      {workflow?.error_message && (
        <div className="rounded border border-red-500/20 bg-red-500/10 p-2 text-[10px] text-red-300">
          {workflow.error_message}
        </div>
      )}
    </div>
  );
}

export default function AgentPage() {
  const [activePane, setActivePane] = useState<"chat" | "scans">("chat");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  // Chat Sessions States
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Chat States
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "agent",
      text: "Hello! I am your AuthClaw Compliance Agent. I orchestrate GDPR, HIPAA, and SOC 2 audits, check active gate rules, and propose infrastructure remediations. How can I assist you today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<AgentResult | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [remediating, setRemediating] = useState(false);

  // HITL Approval States
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [showMfaInput, setShowMfaInput] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleRemediate = async (workflowId: string) => {
    if (!workflowId) return;
    setRemediating(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/remediate`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to trigger remediation");
      }

      const updatedWorkflow = await res.json();
      setSelectedResult(updatedWorkflow);
      await fetchWorkflowsAndApprovals();
    } catch (err: unknown) {
      alert(errorMessage(err, "Error starting remediation"));
    } finally {
      setRemediating(false);
    }
  };

  const fetchWorkflowsAndApprovals = async () => {
    try {
      const res = await fetch("/api/workflows");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load workflows");
      const data = await res.json();
      setWorkflows(data.workflows || []);
      setApprovals(data.approvals || []);
    } catch (err: unknown) {
      console.warn("Agent fetchWorkflowsAndApprovals failed:", errorMessage(err, "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async (autoSelect = false) => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/agent/sessions");
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = await res.json();
      setSessions(data || []);
      if (autoSelect && data && data.length > 0) {
        setActiveSessionId(data[0].id);
      }
    } catch (err: unknown) {
      console.warn("fetchSessions failed:", errorMessage(err, "Unknown error"));
    } finally {
      setSessionsLoading(false);
    }
  };

  const fetchSessionHistory = async (sessionId: string) => {
    setChatLoading(true);
    try {
      const res = await fetch(`/api/agent/sessions/${sessionId}/history`);
      if (!res.ok) throw new Error("Failed to load message history");
      const data = await res.json();
      if (data && data.length > 0) {
        setMessages((data as ChatHistoryMessage[]).map((m) => ({
          sender: m.sender,
          text: m.text,
          timestamp: new Date(m.timestamp),
          results: m.results
        })));
      } else {
        setMessages([
          {
            sender: "agent",
            text: "Hello! I am your AuthClaw Compliance Agent. I orchestrate GDPR, HIPAA, and SOC 2 audits, check active gate rules, and propose infrastructure remediations. How can I assist you today?",
            timestamp: new Date()
          }
        ]);
      }
    } catch (err: unknown) {
      console.warn("fetchSessionHistory failed:", errorMessage(err, "Unknown error"));
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflowsAndApprovals();
    fetchSessions(true);
    const interval = setInterval(fetchWorkflowsAndApprovals, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      fetchSessionHistory(activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleNewChat = async () => {
    try {
      const res = await fetch("/api/agent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (!res.ok) throw new Error("Failed to create chat session");
      const newSession = await res.json();
      setActiveSessionId(newSession.id);
      setSessions((prev) => [newSession, ...prev]);
      setMessages([
        {
          sender: "agent",
          text: "Hello! I am your AuthClaw Compliance Agent. I orchestrate GDPR, HIPAA, and SOC 2 audits, check active gate rules, and propose infrastructure remediations. How can I assist you today?",
          timestamp: new Date()
        }
      ]);
    } catch (err: unknown) {
      alert(errorMessage(err, "Error creating new chat"));
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatLoading) return;

    let sessionId = activeSessionId;

    if (!sessionId) {
      try {
        const createRes = await fetch("/api/agent/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New Chat" }),
        });
        if (!createRes.ok) throw new Error("Failed to auto-create session");
        const newSession = await createRes.json();
        sessionId = newSession.id;
        setActiveSessionId(newSession.id);
        setSessions((prev) => [newSession, ...prev]);
      } catch (err: unknown) {
        alert(errorMessage(err, "Could not start new chat session"));
        return;
      }
    }

    const userText = input;
    setInput("");
    setMessages((prev) => [...prev, { sender: "user", text: userText, timestamp: new Date() }]);
    setChatLoading(true);

    try {
      const res = await fetch(`/api/agent/sessions/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to communicate with Agent");
      }

      const data = await res.json();
      const responseText = data.text || "No response received.";
      const resultsData = data.results || null;
      const newTitle = data.session_title;

      setMessages((prev) => [
        ...prev, 
        { sender: "agent", text: responseText, timestamp: new Date(), results: resultsData }
      ]);

      if (resultsData) {
        setSelectedResult(resultsData);
        setShowRawJson(false); // default to visual report
      }

      if (newTitle) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
        );
      }

      await fetchWorkflowsAndApprovals();
    } catch (err: unknown) {
      setMessages((prev) => [
        ...prev, 
        { sender: "agent", text: `Failed to execute request: ${errorMessage(err, "Unknown error")}`, timestamp: new Date() }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleApproveClick = (appr: Approval) => {
    setSelectedApproval(appr);
    setMfaError(null);
    setTotpCode("");
    setShowMfaInput(true);
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApproval) return;
    setApproving(true);
    setMfaError(null);

    try {
      // Find the associated workflow_id
      // In python app/api/v1/endpoints/workflows.py: approve takes workflow_id, not approval_id!
      // So we must lookup the workflow_id for this approval.
      const wf = workflows.find((w) => w.approval_id === selectedApproval.id);
      if (!wf) {
        throw new Error("No active workflow is linked to this approval record");
      }

      const res = await fetch(`/api/workflows/${wf.workflow_id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp_code: totpCode }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "MFA validation failed");
      }

      setShowMfaInput(false);
      setSelectedApproval(null);
      await fetchWorkflowsAndApprovals();
    } catch (err: unknown) {
      setMfaError(errorMessage(err, "Could not authorize action"));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (appr: Approval) => {
    if (!confirm("Are you sure you want to decline this proposed remediation?")) return;
    try {
      const wf = workflows.find((w) => w.approval_id === appr.id);
      if (!wf) throw new Error("No linked workflow found");

      const res = await fetch(`/api/workflows/${wf.workflow_id}/reject`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reject approval");
      }

      await fetchWorkflowsAndApprovals();
    } catch (err: unknown) {
      alert(errorMessage(err, "Error rejecting approval"));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
          Compliance Agent & Orchestrator
          <Sparkles className="w-5 h-5 text-indigo-400 inline-block ml-2.5 animate-pulse" />
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Review automated cloud remediation tasks, initiate framework audits, and interact with the AI compliance controller.
        </p>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2/3 width) - Chat Interface or Scan Telemetry */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-[#09090d] shadow-2xl flex flex-col min-h-[550px] overflow-hidden">
          
          {/* Header tabs */}
          <div className="px-6 py-4 border-b border-slate-800/80 bg-[#0c0c12]/60 flex items-center justify-between">
            <div className="flex gap-4">
              <button
                onClick={() => setActivePane("chat")}
                className={`text-xs font-bold uppercase tracking-wider transition ${
                  activePane === "chat" ? "text-indigo-400" : "text-slate-500 hover:text-slate-350"
                }`}
              >
                Agent Chat Room
              </button>
              <button
                onClick={() => setActivePane("scans")}
                className={`text-xs font-bold uppercase tracking-wider transition ${
                  activePane === "scans" ? "text-indigo-400" : "text-slate-500 hover:text-slate-350"
                }`}
              >
                Active Scans Ledger
              </button>
            </div>
            
            {chatLoading && (
              <span className="text-[10px] text-slate-500 flex items-center gap-1.5 font-semibold">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                Agent is thinking...
              </span>
            )}
          </div>

          {/* Chat Pane */}
          {activePane === "chat" ? (
            <div className="flex-1 flex overflow-hidden min-h-[440px]">
              {/* Sessions Sidebar */}
              <div className="w-60 border-r border-slate-800/60 bg-[#07070a]/40 flex flex-col justify-between">
                <div className="p-3 border-b border-slate-800/40">
                  <button
                    onClick={handleNewChat}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-indigo-500/20 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 font-bold text-xs shadow-lg transition active:scale-[0.98] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Chat
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[360px]">
                  {sessionsLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 text-[10px]">
                      No active sessions.
                    </div>
                  ) : (
                    sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setActiveSessionId(s.id)}
                        className={`w-full flex items-center gap-2 py-1.5 px-2.5 rounded-lg text-left text-xs transition cursor-pointer ${
                          activeSessionId === s.id
                            ? "bg-slate-800/50 border border-slate-700/60 text-indigo-400 font-semibold"
                            : "hover:bg-slate-850/50 text-slate-400 hover:text-slate-200 border border-transparent"
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Chat Content */}
              <div className="flex-1 flex flex-col justify-between overflow-hidden">
                {/* Message History */}
                <div className="flex-1 p-6 overflow-y-auto space-y-4 max-h-[370px]">
                  {messages.map((msg, idx) => (
                    <div 
                      key={idx}
                      className={`flex gap-3 max-w-[85%] ${
                        msg.sender === "user" ? "ml-auto flex-row-reverse" : ""
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center border ${
                        msg.sender === "user" 
                          ? "bg-indigo-650/10 border-indigo-500/20 text-indigo-400" 
                          : "bg-slate-800/40 border-slate-700/60 text-slate-300"
                      }`}>
                        {msg.sender === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                      </div>

                      <div className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                        msg.sender === "user"
                          ? "bg-indigo-600/10 border border-indigo-500/20 text-indigo-200 rounded-tr-none"
                          : "bg-slate-850/40 border border-slate-800 text-slate-300 rounded-tl-none"
                      }`}>
                        <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
                        {isRagResult(msg.results) && msg.results.citations.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Grounding Evidence</div>
                            {msg.results.citations.slice(0, 3).map((citation: RAGCitation) => (
                              <a
                                key={`${citation.id}-${citation.url}`}
                                href={citation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-start gap-2 rounded-lg border border-slate-800 bg-[#07070a]/70 px-2 py-1.5 text-[10px] text-slate-350 hover:border-indigo-500/50 hover:text-indigo-300 transition"
                              >
                                <BookOpen className="mt-0.5 h-3 w-3 flex-shrink-0 text-indigo-400" />
                                <span className="min-w-0 flex-1">
                                  <span className="font-mono font-bold text-slate-200">{citation.id}</span>
                                  <span className="block truncate">{citation.label}</span>
                                </span>
                                <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-500" />
                              </a>
                            ))}
                          </div>
                        )}
                        {msg.results && (
                          <button
                            onClick={() => {
                              if (msg.results) setSelectedResult(msg.results);
                            }}
                            className="mt-2 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 underline transition cursor-pointer"
                          >
                            {isRagResult(msg.results) ? "View RAG Evidence" : "View Results JSON"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Chat Input */}
                <form onSubmit={handleSend} className="p-3 border-t border-slate-800/80 bg-[#07070a]/40 flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={activeSessionId ? "Ask the Compliance Agent..." : "Click 'New Chat' to start a persistent session..."}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs placeholder-slate-650 focus:outline-none focus:border-indigo-500/80 transition"
                    disabled={chatLoading || !activeSessionId}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !input.trim() || !activeSessionId}
                    className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </div>
          ) : (
            /* Scans Telemetry Pane */
            <div className="flex-1 p-6 overflow-y-auto max-h-[440px] min-h-[440px]">
              {loading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
                </div>
              ) : workflows.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs flex flex-col items-center">
                  <Activity className="w-8 h-8 text-slate-600 mb-2" />
                  No compliance runs initiated yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {workflows.map((wf) => {
                    const isCompleted = wf.execution_status === "COMPLETED";
                    const isPaused = wf.execution_status === "PAUSED";
                    const isSelected = isWorkflowResult(selectedResult) && selectedResult.workflow_id === wf.workflow_id;
                    const remediationActionCount = getRemediationActions(wf).length;
                    return (
                      <button
                        key={wf.id}
                        type="button"
                        onClick={() => {
                          setSelectedResult(wf);
                          setShowRawJson(false);
                        }}
                        className={`w-full text-left p-4 rounded-xl border bg-[#0c0c12]/40 space-y-3 transition cursor-pointer ${
                          isSelected
                            ? "border-indigo-500/60 shadow-[0_0_0_1px_rgba(99,102,241,0.25)]"
                            : "border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              {wf.framework} framework
                            </span>
                            <h4 className="font-bold text-slate-200 text-sm mt-1.5 font-mono">{wf.workflow_id}</h4>
                          </div>

                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isCompleted 
                              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" 
                              : isPaused 
                                ? "bg-amber-500/10 border border-amber-500/20 text-amber-400 animate-pulse"
                                : "bg-sky-500/10 border border-sky-500/20 text-sky-400 animate-pulse"
                          }`}>
                            {wf.execution_status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs pt-2 border-t border-slate-850/60">
                          <div>
                            <p className="text-slate-550 text-[10px]">CURRENT STATE</p>
                            <span className="font-mono text-slate-300 font-semibold">{wf.current_state}</span>
                          </div>
                          <div>
                            <p className="text-slate-550 text-[10px]">RISK SCORE</p>
                            <span className={`font-semibold ${
                              wf.risk_score && wf.risk_score > 0.5 ? "text-red-400" : "text-emerald-400"
                            }`}>
                              {wf.risk_score !== null ? `${(wf.risk_score * 100).toFixed(0)}%` : "N/A"}
                            </span>
                          </div>
                          <div>
                            <p className="text-slate-550 text-[10px]">STARTED AT</p>
                            <span className="text-slate-400 font-mono text-[10px]">
                              {new Date(wf.started_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <div>
                            <p className="text-slate-550 text-[10px]">COMPLETED</p>
                            <span className="text-slate-400 font-mono text-[10px]">
                              {wf.completed_at ? new Date(wf.completed_at).toLocaleTimeString() : "-"}
                            </span>
                          </div>
                        </div>
                        {(wf.remediation_state || remediationActionCount > 0 || wf.error_message) && (
                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-850/60">
                            <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${getActionStatusClass(wf.remediation_state || "PENDING")}`}>
                              {formatStateLabel(wf.remediation_state || "NOT_STARTED")}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {remediationActionCount} action{remediationActionCount === 1 ? "" : "s"}
                            </span>
                            {typeof wf.retry_count === "number" && wf.retry_count > 0 && (
                              <span className="text-[10px] text-amber-400">
                                {wf.retry_count} retr{wf.retry_count === 1 ? "y" : "ies"}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column (1/3 width) - Pending Approvals (HITL) */}
        <div className="space-y-6">
          
          {/* HITL panel */}
          <div className="rounded-2xl border border-slate-800 bg-[#09090d] shadow-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" />
                Human-in-the-Loop Actions
              </h3>
              <p className="text-slate-500 text-[11px] mt-1 leading-normal">
                Remediation adjustments generated by compliance scans that require manual administrator sign-off.
              </p>
            </div>

            <div className="space-y-4">
              {loading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-indigo-500" />
                </div>
              ) : approvals.filter(a => a.status === "PENDING").length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs flex flex-col items-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                  No actions awaiting approval.
                </div>
              ) : (
                approvals.filter(a => a.status === "PENDING").map((appr) => (
                  <div key={appr.id} className="p-3.5 rounded-xl border border-slate-800 bg-[#0c0c12]/60 space-y-3 hover:border-slate-700/80 transition duration-150">
                    <div>
                      <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {appr.action_type.replace("_", " ")}
                      </span>
                      <h4 className="font-bold text-slate-200 text-xs mt-2">{appr.action_description}</h4>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Expires: {new Date(appr.expires_at).toLocaleTimeString()}
                      </p>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleApproveClick(appr)}
                        className="flex-1 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10px] shadow transition active:scale-[0.98]"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(appr)}
                        className="flex-1 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-350 border border-slate-700 text-[10px] font-semibold transition active:scale-[0.98]"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Results Details Panel */}
          <div className="rounded-2xl border border-slate-800 bg-[#09090d] shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs font-bold uppercase tracking-wider">
                <Terminal className="w-4 h-4 text-indigo-400" />
                Inspector Details Panel
              </div>
              {(isWorkflowResult(selectedResult) || isRagResult(selectedResult)) && (
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded border border-slate-800 bg-[#0c0c12] hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                >
                  {showRawJson ? "Visual Report" : "Raw JSON"}
                </button>
              )}
            </div>
            
            {isRagResult(selectedResult) && !showRawJson ? (
              <div className="space-y-4 text-xs max-h-[450px] overflow-y-auto pr-1">
                <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0c0c12]/40 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">RAG Corpus</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                      selectedResult.grounded
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    }`}>
                      {selectedResult.grounded ? "Grounded" : "Insufficient Evidence"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 pt-1 text-[11px]">
                    <div>
                      <p className="text-slate-550 text-[9px] font-bold">VERSION</p>
                      <p className="font-semibold text-slate-350">{selectedResult.corpus_version || "-"}</p>
                    </div>
                    <div>
                      <p className="text-slate-550 text-[9px] font-bold">CITATIONS</p>
                      <p className="font-semibold text-slate-350">{selectedResult.citations?.length || 0}</p>
                    </div>
                  </div>
                  {selectedResult.corpus_checksum && (
                    <p className="font-mono text-[9px] text-slate-550 truncate">{selectedResult.corpus_checksum}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Citations</div>
                  {(!selectedResult.citations || selectedResult.citations.length === 0) ? (
                    <div className="text-slate-500 italic p-3 rounded-xl border border-slate-850 bg-[#07070a] text-center">No matching corpus evidence was retrieved.</div>
                  ) : (
                    <div className="space-y-2">
                      {(selectedResult.citations as RAGCitation[]).map((citation) => (
                        <a
                          key={`${citation.id}-${citation.url}`}
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block p-3 rounded-xl border border-slate-800 bg-[#07070a] hover:border-indigo-500/50 transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-mono text-slate-200 font-bold">{citation.id}</p>
                              <p className="text-slate-350 text-[11px] leading-relaxed">{citation.label}</p>
                              <p className="text-slate-550 text-[10px] truncate">{citation.source_name}</p>
                            </div>
                            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Retrieved Evidence</div>
                  {(selectedResult.retrieved_chunks as RAGChunk[] | undefined)?.map((chunk) => (
                    <div key={`${chunk.id}-${chunk.section_id}`} className="p-3 rounded-xl border border-slate-800 bg-[#07070a] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-bold text-slate-250">{chunk.id}</span>
                        <span className="text-[9px] font-bold text-indigo-400">{chunk.score?.toFixed ? chunk.score.toFixed(2) : chunk.score}</span>
                      </div>
                      <p className="text-slate-350 text-[11px] leading-relaxed">{chunk.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : isWorkflowResult(selectedResult) && !showRawJson ? (
              <div className="space-y-4 text-xs max-h-[450px] overflow-y-auto pr-1">
                {/* Scan Summary */}
                <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0c0c12]/40 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Scan Summary</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                      selectedResult.execution_status === "COMPLETED" 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : selectedResult.execution_status === "PAUSED"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                          : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse"
                    }`}>
                      {selectedResult.execution_status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 pt-1 text-[11px]">
                    <div>
                      <p className="text-slate-550 text-[9px] font-bold">FRAMEWORK</p>
                      <p className="font-semibold text-slate-350">{selectedResult.framework}</p>
                    </div>
                    <div>
                      <p className="text-slate-550 text-[9px] font-bold">RISK SCORE</p>
                      <p className={`font-semibold ${(selectedResult.risk_score ?? 0) > 0.5 ? "text-red-400" : "text-emerald-400"}`}>
                        {selectedResult.risk_score != null ? `${(selectedResult.risk_score * 100).toFixed(0)}%` : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-550 text-[9px] font-bold">STARTED</p>
                      <p className="text-slate-450 font-mono text-[9px]">
                        {selectedResult.started_at ? new Date(selectedResult.started_at).toLocaleTimeString() : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-550 text-[9px] font-bold">COMPLETED</p>
                      <p className="text-slate-450 font-mono text-[9px]">
                        {selectedResult.completed_at ? new Date(selectedResult.completed_at).toLocaleTimeString() : "-"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Findings List */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Findings</div>
                  {(!selectedResult.findings || selectedResult.findings.length === 0) ? (
                    <div className="text-slate-500 italic p-3 rounded-xl border border-slate-850 bg-[#07070a] text-center">No compliance violations found.</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedResult.findings.map((finding: Finding, idx: number) => (
                        <div key={idx} className="p-3 rounded-xl border border-slate-800 bg-[#07070a] space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-slate-200 font-bold">{finding.control}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                              finding.status === "non_compliant"
                                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            }`}>
                              {finding.status === "non_compliant" ? "NON COMPLIANT" : "COMPLIANT"}
                            </span>
                          </div>
                          <p className="text-slate-350 text-[11px] leading-relaxed">{finding.description}</p>
                          <div className="text-[9px] font-mono text-slate-500 leading-normal bg-slate-900/30 p-1.5 rounded border border-slate-850/40">
                            <span className="font-bold text-slate-400">Evidence:</span> {finding.evidence}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Remediation Plan */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Proposed Remediation Plan</div>
                  {(!selectedResult.remediation_plan || selectedResult.remediation_plan.length === 0) ? (
                    <div className="text-slate-500 italic p-3 rounded-xl border border-slate-850 bg-[#07070a] text-center">No remediation actions needed.</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedResult.remediation_plan.map((plan: RemediationPlan, idx: number) => (
                        <div key={idx} className="p-3 rounded-xl border border-slate-800 bg-[#07070a] space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-slate-300">{plan.action}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                              plan.priority === "high"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            }`}>
                              {plan.priority} Priority
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                            <div>
                              <span className="text-slate-550 font-bold">CONTROL:</span> {plan.finding_control}
                            </div>
                            <div>
                              <span className="text-slate-550 font-bold">EST. EFFORT:</span> {plan.estimated_effort}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Remediation Timeline */}
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Remediation Timeline</div>
                  <div className="p-3 rounded-xl border border-slate-800 bg-[#07070a] space-y-2.5">
                    <RemediationTimeline workflow={selectedResult} />
                  </div>
                </div>

                {/* Apply Remediation Button (Explicit Workflow ID) */}
                {selectedResult.execution_status === "COMPLETED" && selectedResult.current_state === "COMPLETE" && (selectedResult.remediation_plan?.length ?? 0) > 0 && (
                  <button
                    onClick={() => handleRemediate(selectedResult.workflow_id || "")}
                    disabled={remediating}
                    className="w-full py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition active:scale-[0.98] disabled:opacity-50 mt-4 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {remediating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Initializing Remediation...
                      </>
                    ) : (
                      "Apply Remediation"
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-850 bg-[#07070a] p-3 text-[10px] font-mono text-slate-400 overflow-x-auto min-h-[140px] max-h-[350px]">
                {selectedResult ? (
                  <pre>{JSON.stringify(selectedResult, null, 2)}</pre>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-650 text-center italic py-12">
                    Select a workflow result or gateway route in the ledger/chat to inspect.
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* MFA TOTP Challenge Modal */}
      {showMfaInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowMfaInput(false)} />
          
          <div className="relative w-full max-w-[400px] rounded-2xl bg-[#0e0e15] border border-slate-800 shadow-2xl p-6 overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full bg-indigo-500/5 blur-[80px] pointer-events-none" />
            
            <div className="flex justify-between items-center mb-6 border-b border-slate-800/80 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-indigo-400" />
                MFA Identity Authorization
              </h3>
              <button onClick={() => setShowMfaInput(false)} className="text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {mfaError && (
              <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs">
                {mfaError}
              </div>
            )}

            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Confirm your administrator status. Enter the 6-digit TOTP code from your authenticator app (or backup recovery code).
              </p>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  TOTP Code / Backup Code
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-650">
                    <KeyRound className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="Enter code"
                    className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#07070a] border border-slate-800 text-slate-200 text-xs font-mono placeholder-slate-700 focus:outline-none focus:border-indigo-500/80 transition text-center tracking-widest"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-850 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowMfaInput(false)}
                  className="px-4 py-2 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-350 font-semibold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approving || !totpCode}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {approving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Authorize Action"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
