/**
 * Phase 16 — Evidence single record and sub-resource proxy
 *
 * GET /api/evidence/[id]               → fetch single evidence record by ID
 * GET /api/evidence/workflow/[id]      → all evidence for a workflow (handled below)
 * GET /api/evidence/framework/[name]   → all evidence for a framework
 */

import { NextResponse } from "next/server";
import { backendFetch, handleApiError } from "@/lib/api-client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await backendFetch(`/v1/evidence/${encodeURIComponent(id)}`);
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
