import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { queryWithTenantContext } from "@/lib/db";
import { backendFetch, handleApiError } from "@/lib/api-client";
import { sessionStore } from "@/lib/session-store";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("authclaw_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = JSON.parse(sessionToken);
    const session = sessionStore.getSession(payload.sessionId);
    if (!session) {
      const response = NextResponse.json({ error: "Unauthorized: Session expired or invalid" }, { status: 401 });
      response.cookies.delete("authclaw_session");
      return response;
    }

    const tenantId = payload.tenantId;

    // Fetch compliance workflows
    const workflowsRes = await queryWithTenantContext(
      tenantId,
      "SELECT id, workflow_id, framework, current_state, execution_status, risk_score, started_at, completed_at, approval_id FROM compliance_workflows WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 50",
      [tenantId]
    );

    // Fetch pending approvals
    const approvalsRes = await queryWithTenantContext(
      tenantId,
      "SELECT id, action_id, action_type, action_description, status, expires_at, created_at FROM pending_approvals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50",
      [tenantId]
    );

    return NextResponse.json({
      workflows: workflowsRes.rows,
      approvals: approvalsRes.rows,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await backendFetch("/v1/workflows", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
