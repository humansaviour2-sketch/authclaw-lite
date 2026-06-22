/**
 * Phase 16 — Evidence Repository proxy routes
 *
 * Forwards requests to the FastAPI backend at /v1/evidence.
 * Supports:
 *   GET /api/evidence                         → list with pagination + filters
 *   GET /api/evidence?evidence_id=<id>        → single record (via ?id param)
 *   GET /api/evidence?workflow_id=<id>        → all evidence for a workflow
 *   GET /api/evidence?framework_filter=<name> → all evidence for a framework
 *
 * The UI fetches /api/evidence with query params which this proxy forwards.
 */

import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Build forwarded params for the paginated list endpoint
    const params: Record<string, string> = {};

    const page = searchParams.get("page");
    if (page) params.page = page;

    const pageSize = searchParams.get("page_size");
    if (pageSize) params.page_size = pageSize;

    const framework = searchParams.get("framework");
    if (framework) params.framework = framework;

    const evidenceType = searchParams.get("evidence_type");
    if (evidenceType) params.evidence_type = evidenceType;

    const severity = searchParams.get("severity");
    if (severity) params.severity = severity;

    const data = await backendFetch("/v1/evidence", { params });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
