import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { backendFetch, handleApiError } from "@/lib/api-client";
import { sessionStore } from "@/lib/session-store";

export const dynamic = "force-dynamic";

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

    // 1. Get open approvals count
    const approvalsRes = await query(
      "SELECT COUNT(*)::integer as count FROM pending_approvals WHERE tenant_id = $1 AND status = 'PENDING'",
      [tenantId]
    );
    const openApprovals = approvalsRes.rows[0]?.count || 0;

    // 2. Get redactions count in last 24 hours
    const redactionsRes = await query(
      "SELECT COUNT(*)::integer as count FROM redaction_tokens WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '24 HOURS'",
      [tenantId]
    );
    const redactions24h = redactionsRes.rows[0]?.count || 0;

    // 3. Get traffic KPIs from audit logs
    let requestsPerSec: number | null = null;
    let p99LatencyMs: number | null = null;
    let totalRequests = 0;

    try {
      const logsData = await backendFetch("/v1/audit-logs?limit=100");
      if (logsData && logsData.records && logsData.records.length > 0) {
        totalRequests = logsData.total || logsData.records.length;
        
        // Calculate P99 Latency if duration_ms exists in logs
        const latencies = logsData.records
          .map((r: any) => r.duration_ms || r.duration)
          .filter((l: any) => l !== undefined && l !== null)
          .sort((a: number, b: number) => a - b);

        if (latencies.length > 0) {
          const p99Index = Math.min(
            latencies.length - 1,
            Math.ceil(latencies.length * 0.99) - 1
          );
          p99LatencyMs = latencies[p99Index];
        }

        // Calculate requests per second based on timestamp of latest and oldest requests
        const timestamps = logsData.records
          .map((r: any) => new Date(r.timestamp || r.created_at).getTime())
          .filter((t: number) => !isNaN(t));

        if (timestamps.length > 1) {
          const maxTime = Math.max(...timestamps);
          const minTime = Math.min(...timestamps);
          const diffSeconds = (maxTime - minTime) / 1000;
          if (diffSeconds > 0) {
            requestsPerSec = Number((timestamps.length / diffSeconds).toFixed(2));
          }
        }
      }
    } catch (err) {
      console.warn("Failed to fetch traffic metrics from ClickHouse/Postgres audit logs:", err);
    }

    return NextResponse.json({
      openApprovals,
      redactions24h,
      totalRequests,
      requestsPerSec,
      p99LatencyMs,
    });
  } catch (error: any) {
    console.error("Dashboard API Error:", error);
    return handleApiError(error);
  }
}
