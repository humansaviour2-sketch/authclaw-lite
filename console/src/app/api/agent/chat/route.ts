import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionStore } from "@/lib/session-store";
import { backendFetch } from "@/lib/api-client";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8080";

function classifyIntent(message: string): "READ_ONLY" | "SCAN_REQUEST" | "EXECUTION_REQUEST" {
  const msg = message.toLowerCase().trim();

  // 1. SCAN_REQUEST matching
  if (
    msg.includes("run gdpr scan") ||
    msg.includes("run hipaa scan") ||
    msg.includes("run soc2 scan") ||
    msg.includes("run soc 2 scan") ||
    /^(run|start|execute|check|trigger|launch)\s+(gdpr|hipaa|soc2|soc\s*2)/.test(msg) ||
    msg.includes("check compliance posture") ||
    msg.includes("compliance posture")
  ) {
    return "SCAN_REQUEST";
  }

  // 2. EXECUTION_REQUEST matching
  if (
    msg.includes("apply remediation") ||
    msg.includes("execute fixes") ||
    msg.includes("deploy policy") ||
    msg.includes("infrastructure modifications") ||
    msg.includes("infrastructure modification") ||
    msg.includes("fix findings") ||
    /^(remediate|fix|apply)/.test(msg)
  ) {
    return "EXECUTION_REQUEST";
  }

  // 3. Defaults to READ_ONLY
  return "READ_ONLY";
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("authclaw_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = JSON.parse(sessionToken);
    const session = sessionStore.getSession(payload.sessionId);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: Session expired or invalid" }, { status: 401 });
    }

    const { message } = await request.json();
    if (!message || !message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const intent = classifyIntent(message);

    if (intent === "SCAN_REQUEST") {
      // Determine framework
      const msgLower = message.toLowerCase();
      let framework = "GDPR";
      if (msgLower.includes("hipaa")) {
        framework = "HIPAA";
      } else if (msgLower.includes("soc")) {
        framework = "SOC2";
      }

      const scanResult = await backendFetch("/v1/workflows", {
        method: "POST",
        body: JSON.stringify({ framework }),
      });

      return NextResponse.json({
        intent: "SCAN_REQUEST",
        text: `Initiating ${framework} compliance scan. EPHEMERAL WORKER started.\n\n[System] Workflow launched successfully! Scan completed immediately without immediate approval. ID: ${scanResult.workflow_id}. State: ${scanResult.current_state}.`,
        workflow: scanResult,
      });
    }

    if (intent === "EXECUTION_REQUEST") {
      // Find UUID in user message
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const match = message.match(uuidRegex);

      if (!match) {
        return NextResponse.json({
          intent: "EXECUTION_REQUEST",
          text: "To apply remediation, please select a completed scan from the ledger on the left and click 'Apply Remediation', or specify the scan UUID in your message (e.g. 'Apply remediation for scan 12345678-abcd-...').",
        });
      }

      const workflowId = match[0];
      const remediateResult = await backendFetch(`/v1/workflows/${workflowId}/remediate`, {
        method: "POST",
      });

      return NextResponse.json({
        intent: "EXECUTION_REQUEST",
        text: `Remediation workflow initiated for scan ${workflowId}. A pending approval has been generated and requires your MFA confirmation to execute remediation.`,
        workflow: remediateResult,
      });
    }

    // READ_ONLY: Query Gemini via the Gateway reverse proxy
    const geminiRes = await fetch(`${GATEWAY_URL}/v1/models/gemini-2.5-flash-lite:generateContent`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: message }
            ]
          }
        ]
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json({ error: `Gateway request failed: ${errText}` }, { status: geminiRes.status });
    }

    const data = await geminiRes.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No reply from Gemini.";

    return NextResponse.json({
      intent: "READ_ONLY",
      text: responseText,
    });

  } catch (error: unknown) {
    return NextResponse.json({ error: (error instanceof Error ? error.message : "Request failed") }, { status: 500 });
  }
}
